import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {ApiService} from "./api-service";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {Cluster} from "aws-cdk-lib/aws-ecs";

export class FargateOtelExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const network = Vpc.fromLookup(this, "OptiflyVpc", {
      tags: { name: "XXXXXXXXX" },
    });

    const cluster = Cluster.fromClusterAttributes(this, "ApiCluster", {
      clusterName: "YYYYYYY",
      vpc: network,
      securityGroups: [],
    });

    new ApiService(this, "ExampleSvc", {
      network,
      cluster
    })
  }
}
