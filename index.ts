import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as app from "./app";
import * as pods from "./pods";
import * as psp from "./psp";
import { config } from "./config";

const projectName = pulumi.getProject();

// Create a list of named clusters where the app will be deployed.
interface Cluster {
    provider: k8s.Provider,
    kubeconfig: pulumi.Output<any>,
    staticAppIp?: pulumi.Output<any>,
}

const aksProvider = new k8s.Provider("aksProvider", {kubeconfig: config.aksKubeconfig});
const eksProvider = new k8s.Provider("eksProvider", {kubeconfig: config.eksKubeconfig});
const gkeProvider = new k8s.Provider("gkeProvider", {kubeconfig: config.gkeKubeconfig});
const localProvider = new k8s.Provider("localProvider", {kubeconfig: config.localKubeconfig});
const bmProvider = new k8s.Provider("bmProvider", {kubeconfig: config.bmKubeconfig});

const clusters: {[key: string]: Cluster} = {
    "aks": { kubeconfig: config.aksKubeconfig, provider: aksProvider, staticAppIp: config.aksStaticAppIp},
    "eks": { kubeconfig: config.eksKubeconfig, provider: eksProvider},
    "gke": { kubeconfig: config.gkeKubeconfig, provider: gkeProvider},
    "local": { kubeconfig: config.localKubeconfig, provider: localProvider},
};

// To export the list of app URLs of the demo app across all clusters.
interface appUrl {
    name: string,
    url: pulumi.Output<string>,
}

// Create the application on each of the clusters.
export let appUrls: appUrl[] = [];
for (const clusterName of Object.keys(clusters)) {
    const cluster = clusters[clusterName];

    // Set the default PodSecurityPolicies.
    const podSecurityPolicies = new psp.PodSecurityPolicy(`${clusterName}`, cluster.kubeconfig);

    const instance = new app.DemoApp(clusterName, {
        provider: cluster.provider,
        staticAppIp: cluster.staticAppIp,
    },{dependsOn: podSecurityPolicies});

    let instanceUrl: appUrl = {name: clusterName, url: instance.appUrl};
    appUrls = appUrls.concat(instanceUrl);
}

/*
// Deploy the psps on each of the clusters, and show-case RBAC &
// least-privilege on EKS.
for (const clusterName of Object.keys(clusters)) {
    const cluster = clusters[clusterName];

    if (clusterName === "eks") {
        let namespaceName = "default"

        // Create a role for the `pulumi:dev-group`.
        let devGroupPspRole = new k8s.rbac.v1.Role(
            "pulumi-dev-group-psp",
            {
                metadata: {
                    namespace: namespaceName,
                },
                rules: [
                    {
                        apiGroups: ["", "apps"],
                        resources: ["pods", "deployments", "replicasets", "persistentvolumeclaims"],
                        verbs: ["get", "list", "watch", "create", "update", "delete"],
                    },
                ],
            },
            {
                provider: cluster.provider,
            },
        );

        // Role bind the "pulumi:dev-group" to the k8s role for the default namespace.
        let devGroupPspRoleBinding = new k8s.rbac.v1.RoleBinding("pulumi-dev-group-psp", {
            metadata: {
                namespace: namespaceName,
            },
            subjects: [{
                kind: "Group",
                name: "pulumi:dev-group",
            }],
            roleRef: {
                kind: "Role",
                name: devGroupPspRole.metadata.name,
                apiGroup: "rbac.authorization.k8s.io",
            },
        }, {provider: cluster.provider});

        // Create the r00t pod.
        const root = new pods.Root(`root-${clusterName}`, {
            namespace: namespaceName,
            provider: cluster.provider,
            // provider: bmProvider,
        },
            {dependsOn: devGroupPspRoleBinding},
        );

        // Create docker-in-docker pod.
        const dind = new pods.Dind(`dind-${clusterName}`, {
            namespace: namespaceName,
            provider: cluster.provider,
            // provider: bmProvider,
        },
            {dependsOn: devGroupPspRoleBinding},
        );
    }
}
*/
