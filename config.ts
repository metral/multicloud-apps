import * as pulumi from "@pulumi/pulumi";

let pulumiConfig = new pulumi.Config();

// Existing EKS cluster Pulumi stack.
// Stack reference to eksClusterStack in format:
// <organization>/<project>/<stack> e.g. "myuser/eks-cluster/dev"
const multicloud = new pulumi.StackReference("metral/multicloud/talk1");

export const config = {
    aksStaticAppIp: multicloud.getOutput("aksStaticAppIp"),
    aksKubeconfig: multicloud.getOutput("aksKubeconfig"),
    eksKubeconfig: multicloud.getOutput("eksKubeconfig"),
    gkeKubeconfig: multicloud.getOutput("gkeKubeconfig"),
    localKubeconfig: multicloud.getOutput("localKubeconfig"),
    bmKubeconfig: multicloud.getOutput("bmKubeconfig"),
};
