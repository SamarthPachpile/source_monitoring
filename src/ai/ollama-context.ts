import { supabaseService } from '../supabase/supabase.service';
import { RegParagraphRow } from '../supabase/html-parser';

export interface OllamaPromptPayload {
  model: string;
  format: 'json';
  prompt: string;
  stream: false;
}

export interface ClauseComparisonContext {
  refPath: string;
  oldClause: RegParagraphRow | null;
  newClause: RegParagraphRow | null;
  payload: OllamaPromptPayload;
}

export class OllamaContextService {
  /**
   * Relational Context Retrieval for Ollama:
   * Fetches only the targeted paragraphs by ref_path and builds a structured prompt payload
   */
  public async buildClauseComparisonPrompt(params: {
    oldDocId: string;
    newDocId: string;
    refPath: string;
    model?: string;
  }): Promise<ClauseComparisonContext> {
    const { oldDocId, newDocId, refPath, model = 'llama3.1' } = params;

    // 1. Exact deterministic query to Supabase for the specific clauses
    const [oldClause, newClause] = await Promise.all([
      supabaseService.getParagraphByRefPath(oldDocId, refPath),
      supabaseService.getParagraphByRefPath(newDocId, refPath)
    ]);

    const oldText = oldClause?.text || '[CLAUSE NOT PRESENT IN PREVIOUS VERSION]';
    const newText = newClause?.text || '[CLAUSE DELETED IN NEW VERSION]';

    // 2. Structured prompt injection inside untrusted delimiters
    const prompt = `You are a Senior Regulatory Compliance Analyst specializing in Central Bank Directives.
Compare these two regulatory clauses and classify the change.

[OLD_CLAUSE]:
${oldText}

[NEW_CLAUSE]:
${newText}

Provide your analysis strictly as a JSON object with the following schema:
{
  "changeType": "AMENDMENT" | "CLARIFICATION" | "STRICTER_REQUIREMENT" | "NO_CHANGE" | "REMOVAL",
  "summary": "Concise summary of the key change",
  "exactAddedSpans": ["exact verbatim substring added"],
  "exactRemovedSpans": ["exact verbatim substring removed"],
  "impactLevel": "HIGH" | "MEDIUM" | "LOW"
}`;

    const payload: OllamaPromptPayload = {
      model,
      format: 'json',
      prompt,
      stream: false
    };

    return {
      refPath,
      oldClause,
      newClause,
      payload
    };
  }

  /**
   * Deterministic Span Verifier:
   * Verifies that any text span cited by the LLM exists VERBATIM in the source text.
   * Prevents hallucinations and ensures compliance-grade verification.
   */
  public verifySpan(sourceText: string, candidateSpan: string): boolean {
    if (!sourceText || !candidateSpan) return false;
    const normalizedSource = sourceText.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedSpan = candidateSpan.replace(/\s+/g, ' ').trim().toLowerCase();
    return normalizedSource.includes(normalizedSpan);
  }
}

export const ollamaContextService = new OllamaContextService();
