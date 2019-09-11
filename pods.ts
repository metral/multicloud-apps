import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface RootArgs {
    namespace: pulumi.Input<string>
    provider: k8s.Provider
}

export class Root extends pulumi.ComponentResource {
    public appUrl: pulumi.Output<string>;
    constructor(name: string,
        args: RootArgs,
        opts: pulumi.ComponentResourceOptions = {})
    {
        super("examples:kubernetes-ts-multicloud:demo-app", name, args, opts);
        const appLabels = {app: name};
        const deploy = new k8s.core.v1.Pod(name,
            {
                metadata: { labels: appLabels, namespace: args.namespace },
                spec: {
                    containers: [
                        {
                            name: name,
                            image: "alpine:3.7",
                            command: ["nsenter", "--mount=/proc/1/ns/mnt", "--", "/bin/sleep", "99d"],
                            securityContext: {
                                privileged: true,
                            },
                        },
                    ],
                },
            },
            {
                provider: args.provider,
            },
        );
    }
}

export interface DindArgs {
    namespace: pulumi.Input<string>
    provider?: k8s.Provider
}

export class Dind extends pulumi.ComponentResource {
    public appUrl: pulumi.Output<string>;

    constructor(name: string,
                args: DindArgs,
                opts: pulumi.ComponentResourceOptions = {}) {
        super("examples:kubernetes-ts-multicloud:demo-app", name, args, opts);
        const appLabels = {app: name};
        const deploy = new k8s.core.v1.Pod(name,
            {
                metadata: { labels: appLabels, namespace: args.namespace},
                spec: {
                    hostPID: true,
                    containers: [
                        {
                            name: name,
                            image: "quay.io/mauilion/dind:master",
                            securityContext: {
                                privileged: true,
                            },
                        }
                    ],
                    volumes: [
                        {
                            name: "docker-socket",
                            hostPath: {
                                path: "/var/run/docker.sock",
                            },
                        }
                    ],
                },
            },
            {
                provider: args.provider,
            },
        );
    }
}
