/**
 * ModelRegistry — tracks registered models, their versions and status.
 *
 * Only a model marked `production` may influence real signals (enforced
 * by the production gate). Candidates/challengers are tracked but inert.
 */

export type ModelStatus = "candidate" | "challenger" | "production" | "retired";

export interface RegisteredModel {
  modelId: string;
  version: string;
  status: ModelStatus;
  registeredAt: number;
  /** Free-form note (e.g. last validation period/dataset). */
  note?: string;
}

export class ModelRegistry {
  private readonly models = new Map<string, RegisteredModel>();

  register(modelId: string, version: string, status: ModelStatus = "candidate", note?: string): RegisteredModel {
    const rec: RegisteredModel = {
      modelId,
      version,
      status,
      registeredAt: Date.now(),
      note,
    };
    this.models.set(this.key(modelId, version), rec);
    return rec;
  }

  /** Promote a model to production, demoting any current production. */
  promote(modelId: string, version: string): void {
    for (const m of this.models.values()) {
      if (m.status === "production") m.status = "retired";
    }
    const rec = this.get(modelId, version);
    if (!rec) throw new Error(`Unknown model ${modelId}@${version}`);
    rec.status = "production";
  }

  get(modelId: string, version: string): RegisteredModel | undefined {
    return this.models.get(this.key(modelId, version));
  }

  currentProduction(): RegisteredModel | undefined {
    return [...this.models.values()].find((m) => m.status === "production");
  }

  list(): RegisteredModel[] {
    return [...this.models.values()];
  }

  private key(modelId: string, version: string): string {
    return `${modelId}@${version}`;
  }
}
