import { RegulatorySourceAdapter, SourceHealth } from './types';
import { samaAdapter } from './adapters/sama.adapter';
import { cbuaeAdapter } from './adapters/cbuae.adapter';
import { rbiAdapter } from './adapters/rbi.adapter';
import { cbkAdapter } from './adapters/cbk.adapter';

export class SourceRegistry {
  private adapters: Map<string, RegulatorySourceAdapter> = new Map();

  constructor() {
    this.register(samaAdapter);
    this.register(cbuaeAdapter);
    this.register(rbiAdapter);
    this.register(cbkAdapter);
  }

  public register(adapter: RegulatorySourceAdapter): void {
    this.adapters.set(adapter.sourceKey.toLowerCase(), adapter);
  }

  public getAdapter(sourceKey: string): RegulatorySourceAdapter | undefined {
    return this.adapters.get(sourceKey.toLowerCase());
  }

  public getAllAdapters(): RegulatorySourceAdapter[] {
    return Array.from(this.adapters.values());
  }

  public getInitialSourceHealthList(): SourceHealth[] {
    return this.getAllAdapters().map((a) => ({
      sourceKey: a.sourceKey,
      authority: a.authority,
      jurisdiction: a.jurisdiction,
      region: a.region,
      startingUrl: a.startingUrl,
      enabled: true,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      status: 'not_checked',
      lastError: null
    }));
  }
}

export const sourceRegistry = new SourceRegistry();
