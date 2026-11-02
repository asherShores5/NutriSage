import { App, Tags } from "aws-cdk-lib";
import { buildApp } from "../lib/app";

// Region: `-c region=...`, else us-west-1. The dev desktop sets AWS_REGION=us-west-2 globally, so
// this deliberately does not read it.
const app = new App();
Tags.of(app).add("app", "nutrisage");
buildApp(app, { region: app.node.tryGetContext("region") ?? "us-west-1" });
