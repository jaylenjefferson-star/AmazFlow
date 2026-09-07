import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";

class AmazFlowControlPlaneStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope,id,props);
    const data = new dynamodb.Table(this,"ControlPlane",{ partitionKey:{name:"pk",type:dynamodb.AttributeType.STRING}, sortKey:{name:"sk",type:dynamodb.AttributeType.STRING}, billingMode:dynamodb.BillingMode.PAY_PER_REQUEST, encryption:dynamodb.TableEncryption.AWS_MANAGED, pointInTimeRecovery:true, removalPolicy:cdk.RemovalPolicy.RETAIN });
    data.addGlobalSecondaryIndex({ indexName:"byStatus", partitionKey:{name:"gsi1pk",type:dynamodb.AttributeType.STRING}, sortKey:{name:"gsi1sk",type:dynamodb.AttributeType.STRING}, projectionType:dynamodb.ProjectionType.ALL });
    new logs.LogGroup(this,"AuditLogGroup",{ retention:logs.RetentionDays.ONE_MONTH, removalPolicy:cdk.RemovalPolicy.RETAIN });
    new cdk.CfnOutput(this,"ControlPlaneTableName",{value:data.tableName});
  }
}

const app = new cdk.App();
new AmazFlowControlPlaneStack(app,"AmazFlowDevControlPlane",{ env:{ account:process.env.CDK_DEFAULT_ACCOUNT, region:process.env.CDK_DEFAULT_REGION ?? "us-east-1" }, tags:{Product:"AmazFlow",Environment:"dev",DataBoundary:"synthetic-only"} });
