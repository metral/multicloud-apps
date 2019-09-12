import * as pulumi from "@pulumi/pulumi"; import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as jsyaml from "js-yaml";
import * as path from "path";
import * as process from "process";
import * as tmp from "tmp";
import which = require("which");

// Map of required cloud provider pod security policies that must remain in the
// cluster.
const requiredCloudPsps: {[key: string]: string[]} = {
    "aks": ["podsecuritypolicy.extensions/privileged"],
    "eks": [],
    "gke": ["podsecuritypolicy.extensions/gce.event-exporter",
        "podsecuritypolicy.extensions/gce.fluentd-gcp",
        "podsecuritypolicy.extensions/gce.persistent-volume-binder",
        "podsecuritypolicy.extensions/gce.privileged",
        "podsecuritypolicy.extensions/gce.unprivileged-addon"],
    "local": [],
};

// PodSecurityPolicyInputs implements the type to use for the state (olds),
// and input (news) of the dynamic provider.
interface PodSecurityPolicyInputs {
    kubeconfig: string;
    requiredCloudPsps: string[];
    requiredPsps: string[];
}

// Applies the user required pod security policies from it's manifest.
function applyPodSecurityPolicyYaml(yamlManifests: YamlManifest[], kubeconfig: string) {
    for (const manifest of yamlManifests) {
        // Compute the required YAML and dump it to a file.
        const tmpYaml = tmp.fileSync();
        fs.writeFileSync(tmpYaml.fd, manifest.text);

        kubectl(`apply -f ${tmpYaml.name}`, kubeconfig);
    }
}

// Get the names of the current pod security policies installed in the cluster.
function getAllPodSecurityPolicyNames(kubeconfig: string): string[] {
    return kubectl(`get psp -o name`, kubeconfig).toString().trim().split('\n');
}

// Exec a kubectl command.
function kubectl(subcommand: string, kubeconfig: string) {
    // Dump the kubeconfig to a file.
    const tmpKubeconfig = tmp.fileSync();
    fs.writeFileSync(tmpKubeconfig.fd, kubeconfig);

    // Call kubectl to delete the PSP.
    return childProcess.execSync(`kubectl ${subcommand}`, {
        env: { ...process.env, "KUBECONFIG": tmpKubeconfig.name },
    });
}

// Aggregate the required pod security policies that must be installed in the cluster.
function aggregateRequiredPsps(inputs: PodSecurityPolicyInputs): string[] {
    return [...inputs.requiredPsps, ...inputs.requiredCloudPsps];
}

// Restore the cluster's pod security policies to the required cloud and cluster defaults.
function restoreRequiredPsps(name: string, yamlManifests: YamlManifest[], inputs: PodSecurityPolicyInputs): PodSecurityPolicyInputs{
    for (const manifest of yamlManifests) {
        // Set the user-required, and cloud provider required pod security policies.
        let psp = jsyaml.safeLoadAll(manifest.text).filter(o => o.kind === "PodSecurityPolicy")[0];
        inputs.requiredPsps.push(`podsecuritypolicy.extensions/${psp.metadata.name}`);
    }
    inputs.requiredCloudPsps = requiredCloudPsps[name];
    let required = aggregateRequiredPsps(inputs);

    // Get the current psps in the cluster.
    let currentPspNames = getAllPodSecurityPolicyNames(inputs.kubeconfig);

    // Compute the pod security policies to remove from the cluster that
    // are not in the required list.
    let pspsToDelete = currentPspNames.filter(pspName => !required.includes(pspName));

    // Note: psp design requires that we create psps before deleting any.

    // Create our required psps in the cluster.
    applyPodSecurityPolicyYaml(yamlManifests, inputs.kubeconfig);

    // Delete any unnecessary psps.
    for (const pspName of pspsToDelete) {
        if (pspName !== "") {
            kubectl(`delete ${pspName}`, inputs.kubeconfig);
        }
    }

    return inputs;
}

// YamlManifest holds the necessary information to work with a k8s YAML manifest.
interface YamlManifest {
    filepath: string;
    text: string;
}

/*
 * PodSecurityPolicy manages the configuration of pod security policies for a
 * given cloud provider cluster.
 *
 * The psps installed and managed are:
 *  - The required cloud provider psps in `requiredCloudPsps` and,
 *  - The required `demo-restrictive` psp and it's RBAC.
 */
export class PodSecurityPolicy extends pulumi.dynamic.Resource {
    constructor(name: string, kubeconfig: pulumi.Input<any>,  opts?: pulumi.CustomResourceOptions) {
        // Check to ensure that kubectl is installed, as we'll need it in order
        // to deploy k8s resources below.
        try {
            which.sync("kubectl");
        } catch (err) {
            throw new Error("Could not set PodSecurityPolicy options: kubectl is missing.");
        }

        // Read the YAML manifests for the psps we want to add.
        const yamlManifests: YamlManifest[] = [];
        yamlManifests.push(<YamlManifest>{
            filepath: path.join(__dirname, "psp", "restrictive.yaml"),
            text: fs.readFileSync(path.join(__dirname, "psp", "restrictive.yaml")).toString(),
        });

        // Replace eks privileged PSP with default that is not ALLOW all for
        // all, only kube-system service accounts.
        if (name === "eks"){
            yamlManifests.push(<YamlManifest>{
                filepath: path.join(__dirname, "psp", "privileged.yaml"),
                text: fs.readFileSync(path.join(__dirname, "psp", "privileged.yaml")).toString(),
            });
        }

        // Create a dynamic provider for a CRUD workflow on cluster PSPs.
        const provider = {
            // check: (state: any, inputs: any) => Promise.resolve({inputs: inputs, failedChecks: []}),
            diff: (id: pulumi.ID, state: PodSecurityPolicyInputs, inputs: PodSecurityPolicyInputs) => {
                // Get the current psps in the cloud provider.
                let currentPsps = getAllPodSecurityPolicyNames(state.kubeconfig);

                // Get the required, default psps that must be installed in the cluster.
                let requiredPsps = aggregateRequiredPsps(state);

                // Check if there are any required psps missing that should be installed.
                let missingPsps = requiredPsps.filter(pspName => !currentPsps.includes(pspName));
                if (missingPsps.length > 0){
                    return Promise.resolve({changes: true});
                }
                return Promise.resolve({});
            },
            create: (inputs: PodSecurityPolicyInputs) => {
                inputs.requiredPsps = [];
                inputs.requiredCloudPsps = [];
                inputs = restoreRequiredPsps(name, yamlManifests, inputs);
                return Promise.resolve({id: crypto.randomBytes(8).toString("hex"), outs: inputs});
            },
            // read: (id: pulumi.ID, state: PodSecurityPolicyInputs) => Promise.resolve({id: id, props: state}),
            update: (id: pulumi.ID, state: PodSecurityPolicyInputs, inputs: PodSecurityPolicyInputs) => {
                inputs = restoreRequiredPsps(name, yamlManifests, state);
                return Promise.resolve({outs: inputs});
            },
            delete: (id: pulumi.ID, state: PodSecurityPolicyInputs) => {
                for (const manifest of yamlManifests) {
                    kubectl(`delete -f ${manifest.filepath}`, state.kubeconfig);
                }
                return Promise.resolve();
            },
        };

        // Create the dynamic provider.
        let props = <PodSecurityPolicyInputs>{kubeconfig: kubeconfig};
        super(provider, name, props, opts);
    }
}
