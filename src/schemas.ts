import { z } from "zod";

export const WikiKindSchema = z.enum(["source", "concept", "entity", "comparison", "answer"]);
export type WikiKind = z.infer<typeof WikiKindSchema>;

export const SourceRefSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine(
      (path) => /^(?:raw|canonical|wiki)\/.+/.test(path) && !path.includes("\\") && !path.split("/").includes(".."),
      "source path must stay under raw/, canonical/, or wiki/",
    ),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  locators: z.array(z.string().min(1)).min(1),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const WikiPagePatchSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  kind: WikiKindSchema,
  content: z.string().min(1),
  locators: z.array(z.string().min(1)).min(1).default(["document"]),
});
export type WikiPagePatch = z.infer<typeof WikiPagePatchSchema>;

export const WikiPatchSchema = z.object({
  summary: z.string().min(1),
  pages: z.array(WikiPagePatchSchema).min(1),
});
export type WikiPatch = z.infer<typeof WikiPatchSchema>;

export const FactSetSchema = z.object({
  summary: z.string().min(1),
  facts: z
    .array(
      z.object({
        statement: z.string().min(1),
        locator: z.string().min(1),
        topics: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type FactSet = z.infer<typeof FactSetSchema>;

export const EvidenceSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  source: z.string().min(1),
  locator: z.string().min(1),
  text: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const AnswerSchema = z.object({
  answer: z.string().min(1),
  citations: z
    .array(
      z.object({
        evidence_id: z.string().regex(/^E\d+$/),
        claim: z.string().min(1),
      }),
    )
    .min(1),
  insufficient_evidence: z.boolean().default(false),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const SemanticLintSchema = z.object({
  contradictions: z.array(
    z.object({
      pages: z.array(z.string()).min(2),
      description: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
});

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expected_sources: z.array(z.string().min(1)).min(1),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;
