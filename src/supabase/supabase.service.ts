import { getSupabaseClient, isSupabaseConfigured } from './client';
import {
  ParsedHierarchy,
  RegDocumentRow,
  RegSectionRow,
  RegParagraphRow
} from './html-parser';
import { logger } from '../utils/logger';

export class SupabaseService {
  private static instance: SupabaseService;

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  /**
   * Ingest an entire parsed regulatory document hierarchy into Supabase:
   * 1. Upsert reg_documents
   * 2. Upsert reg_sections
   * 3. Batch insert/upsert reg_paragraphs
   */
  public async ingestHierarchy(hierarchy: ParsedHierarchy): Promise<{
    documentId: string;
    sectionsCount: number;
    paragraphsCount: number;
  }> {
    if (!isSupabaseConfigured()) {
      throw new Error(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in your environment.'
      );
    }

    const supabase = getSupabaseClient();
    const { document, sections, paragraphs } = hierarchy;

    logger.info(
      { docId: document.id, title: document.title, sections: sections.length, paragraphs: paragraphs.length },
      'Upserting regulatory document hierarchy into Supabase'
    );

    // 1. Upsert reg_documents
    const { error: docError } = await supabase
      .from('reg_documents')
      .upsert(document, { onConflict: 'id' });

    if (docError) {
      logger.error({ error: docError.message, docId: document.id }, 'Failed to upsert reg_documents');
      throw new Error(`Failed to upsert reg_documents: ${docError.message}`);
    }

    // 2. Upsert reg_sections (if any)
    if (sections.length > 0) {
      const { error: secError } = await supabase
        .from('reg_sections')
        .upsert(sections, { onConflict: 'id' });

      if (secError) {
        logger.error({ error: secError.message, docId: document.id }, 'Failed to upsert reg_sections');
        throw new Error(`Failed to upsert reg_sections: ${secError.message}`);
      }
    }

    // 3. Upsert reg_paragraphs in chunks of 100 for optimal batch performance
    if (paragraphs.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < paragraphs.length; i += chunkSize) {
        const chunk = paragraphs.slice(i, i + chunkSize);
        const { error: paraError } = await supabase
          .from('reg_paragraphs')
          .upsert(chunk, { onConflict: 'id' });

        if (paraError) {
          logger.error(
            { error: paraError.message, docId: document.id, chunkStart: i },
            'Failed to upsert reg_paragraphs chunk'
          );
          throw new Error(`Failed to upsert reg_paragraphs chunk: ${paraError.message}`);
        }
      }
    }

    logger.info(
      { docId: document.id, sections: sections.length, paragraphs: paragraphs.length },
      'Successfully ingested regulatory hierarchy into Supabase'
    );

    return {
      documentId: document.id,
      sectionsCount: sections.length,
      paragraphsCount: paragraphs.length
    };
  }

  /**
   * Fetch paragraphs for Relational Context Retrieval (Ollama / AI pipeline)
   */
  public async getParagraphsForDocument(docId: string): Promise<RegParagraphRow[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('reg_paragraphs')
      .select('*')
      .eq('doc_id', docId)
      .order('ref_path', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch paragraphs for doc ${docId}: ${error.message}`);
    }

    return (data as RegParagraphRow[]) || [];
  }

  /**
   * Fetch a specific paragraph by ref_path for exact clause diff comparison
   */
  public async getParagraphByRefPath(
    docId: string,
    refPath: string
  ): Promise<RegParagraphRow | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('reg_paragraphs')
      .select('*')
      .eq('doc_id', docId)
      .eq('ref_path', refPath)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch paragraph ${refPath} for doc ${docId}: ${error.message}`);
    }

    return data as RegParagraphRow | null;
  }
}

export const supabaseService = SupabaseService.getInstance();
