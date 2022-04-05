import { Construct } from "constructs";
import {
    Compatibility,
    ContainerDefinitionOptions,
    ContainerImage,
    FargateService, ICluster,
    LogDriver,
    NetworkMode,
    Protocol,
    TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";


export interface ApiServiceInterface {
    cluster: ICluster;
    network: IVpc;
}

export class ApiService extends Construct {
    public readonly taskRole: Role;
    public readonly service: FargateService;
    constructor(scope: Construct, id: string, props: ApiServiceInterface) {
        super(scope, id);
        const { cluster, network } = props;

        const securityGroup = this.getSecurityGroup(network);
        const taskRole = this.getRole();
        const taskDefinition = this.getTaskDefinition(taskRole, "512", "1024");
        taskDefinition.addContainer(
            "apiSvcTaskDefinition",
            this.getContainerOptions()
        );
        this.addOtel(taskDefinition, taskRole);

        const service = new FargateService(this, "ApiService", {
            assignPublicIp: false,
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            cluster,
            serviceName: "ExampleService",
            securityGroups: [securityGroup],
            taskDefinition,
            enableECSManagedTags: true,
            capacityProviderStrategies: [
                {
                    capacityProvider: "FARGATE_SPOT",
                    weight: 2,
                },
                {
                    capacityProvider: "FARGATE",
                    weight: 1,
                    base: 1,
                },
            ],
        });
        this.taskRole = taskRole;
        this.service = service;
    }

    private getSecurityGroup = (network: IVpc) => {
        return new SecurityGroup(this, `ApiSvcSecurityGroup`, {
            allowAllOutbound: true,
            vpc: network,
            securityGroupName: "ExampleApiSecurityGroup",
        });
    };

    private getRole = () => {
        const taskRole = new Role(this, "RoleSvc", {
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
        });
        taskRole.addManagedPolicy({
            managedPolicyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
        });
        return taskRole;
    };

    private getTaskDefinition = (taskRole: Role, cpu: string, memory: string) => {
        return new TaskDefinition(this, `ApiSvcDefinition`, {
            compatibility: Compatibility.FARGATE,
            cpu,
            networkMode: NetworkMode.AWS_VPC,
            memoryMiB: memory,
            taskRole,
        });
    };

    private getContainerOptions = (): ContainerDefinitionOptions => {
        return {
            image: ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
            essential: true,
            portMappings: [
                {
                    containerPort: 80,
                    hostPort: 80,
                    protocol: Protocol.TCP,
                },
            ],
            logging: LogDriver.awsLogs({
                logRetention: RetentionDays.ONE_WEEK,
                streamPrefix: "/ecs/api-svc",
            }),
            healthCheck: {
                command: ["CMD-SHELL", "curl -f http://127.0.0.1/ || exit 1"],
                timeout: Duration.seconds(10),
                startPeriod: Duration.seconds(10),
            },
        };
    };

    private addOtel = (taskDefinition: TaskDefinition, taskRole: Role) => {
        taskRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "logs:PutLogEvents",
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:DescribeLogStreams",
                    "logs:DescribeLogGroups",
                    "xray:PutTraceSegments",
                    "xray:PutTelemetryRecords",
                    "xray:GetSamplingRules",
                    "xray:GetSamplingTargets",
                    "xray:GetSamplingStatisticSummaries",
                    "ssm:GetParameters",
                ],
                resources: ["*"],
            })
        );
        taskDefinition.addContainer("otelContainer", {
            image: ContainerImage.fromRegistry("public.ecr.aws/aws-observability/aws-otel-collector:latest"),
            command: ["--config=/etc/ecs/container-insights/otel-task-metrics-config.yaml"],
            essential: true,
            portMappings: [
                {
                    containerPort: 4317,
                    hostPort: 4317,
                    protocol: Protocol.UDP,
                },
                {
                    containerPort: 4318,
                    hostPort: 4318,
                    protocol: Protocol.UDP,
                },
                {
                    containerPort: 2000, //xray port
                    hostPort: 2000,
                    protocol: Protocol.UDP,
                },
                {
                    containerPort: 13133, //healthcheck
                    hostPort: 13133,
                    protocol: Protocol.TCP,
                },
            ],
            healthCheck: {
                command: ["CMD-SHELL", "curl -f http://127.0.0.1:13133/ || exit 1"],
                timeout: Duration.seconds(10),
                startPeriod: Duration.seconds(10),
            },
            logging: LogDriver.awsLogs({
                logRetention: RetentionDays.ONE_WEEK,
                streamPrefix: "/ecs/otel-sidecar-collector",
            }),
        });
    };
}
