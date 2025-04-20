import { z } from "zod";

// Schema definitions for Restate API responses
export const ServiceNameRevPairSchema = z.object({
  name: z.string(),
  revision: z.number().int().min(0),
});

// Deployment response schemas
export const DeploymentBaseSchema = z.object({
  id: z.string(),
  services: z.array(ServiceNameRevPairSchema),
});

export const HttpDeploymentSchema = DeploymentBaseSchema.extend({
  uri: z.string(),
  protocol_type: z.enum(["RequestResponse", "BidiStream"]),
  http_version: z.string(),
  created_at: z.string(),
  min_protocol_version: z.number().int(),
  max_protocol_version: z.number().int(),
  additional_headers: z.record(z.string()).optional(),
});

export const LambdaDeploymentSchema = DeploymentBaseSchema.extend({
  arn: z.string(),
  assume_role_arn: z.string().nullable().optional(),
  created_at: z.string(),
  min_protocol_version: z.number().int(),
  max_protocol_version: z.number().int(),
  additional_headers: z.record(z.string()).optional(),
});

export const DeploymentResponseSchema = z.union([HttpDeploymentSchema, LambdaDeploymentSchema]);
export const ListDeploymentsResponseSchema = z.object({
  deployments: z.array(DeploymentResponseSchema),
});

// Handler metadata schema
export const HandlerMetadataSchema = z.object({
  name: z.string(),
  ty: z.enum(["Exclusive", "Shared", "Workflow"]).nullable().optional(),
  documentation: z.string().nullable().optional(),
  metadata: z.record(z.string()).optional(),
  input_description: z.string(),
  output_description: z.string(),
  input_json_schema: z.any().nullable().optional(),
  output_json_schema: z.any().nullable().optional(),
});

// Service metadata schema
export const ServiceMetadataSchema = z.object({
  name: z.string(),
  handlers: z.array(HandlerMetadataSchema),
  ty: z.enum(["Service", "VirtualObject", "Workflow"]),
  documentation: z.string().nullable().optional(),
  metadata: z.record(z.string()).optional(),
  deployment_id: z.string(),
  revision: z.number().int().min(0),
  public: z.boolean(),
  idempotency_retention: z.string(),
  workflow_completion_retention: z.string().nullable().optional(),
  inactivity_timeout: z.string().nullable().optional(),
  abort_timeout: z.string().nullable().optional(),
});

export const ListServicesResponseSchema = z.object({
  services: z.array(ServiceMetadataSchema),
});

// Registration request schemas
export const HttpRegisterDeploymentRequestSchema = z.object({
  uri: z.string(),
  additional_headers: z.record(z.string()).nullable().optional(),
  use_http_11: z.boolean().default(false).optional(),
  force: z.boolean().default(true).optional(),
  dry_run: z.boolean().default(false).optional(),
});

export const LambdaRegisterDeploymentRequestSchema = z.object({
  arn: z.string(),
  assume_role_arn: z.string().nullable().optional(),
  additional_headers: z.record(z.string()).nullable().optional(),
  force: z.boolean().default(true).optional(),
  dry_run: z.boolean().default(false).optional(),
});

export const RegisterDeploymentRequestSchema = z.union([
  HttpRegisterDeploymentRequestSchema,
  LambdaRegisterDeploymentRequestSchema,
]);

export const RegisterDeploymentResponseSchema = z.object({
  id: z.string(),
  services: z.array(ServiceMetadataSchema),
});
