import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import { CareNoteType } from '../../../common/enums';
import { IAiGenerationStrategy, AiTokenUsage } from '../interfaces/ai-generation-strategy.interface';
import { ChatCompletion } from 'openai/resources/chat';
import { AIProvider } from '../../../common/enums';

@Injectable()
export class GeminiStrategy implements IAiGenerationStrategy {
  private readonly logger = new Logger('GeminiStrategy');
  private genAI: GoogleGenerativeAI;
  private lastTokenUsage: AiTokenUsage | null = null;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  getLastTokenUsage(): AiTokenUsage | null {
    const usage = this.lastTokenUsage;
    this.lastTokenUsage = null;
    return usage;
  }
  generateStructuredTranscript(text: string, temperature: number, model: string, context: string): Promise<ChatCompletion> {
    throw new Error('Method not implemented.');
  }
  getSupportedModels(operation: 'transcription' | 'generation' | 'image_analysis'): string[] {
    throw new Error('Method not implemented.');
  }
  getDefaultGenerationModel(): string {
    throw new Error('Method not implemented.');
  }
  getProvider(): AIProvider {
    throw new Error('Method not implemented.');
  }
  transcribeAudio(filePath: string, language: string): Promise<{ text: string; }> {
    throw new Error('Method not implemented.');
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
      await model.generateContent('Ping');
      return { healthy: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        healthy: false,
        details: `Gemini API health check failed: ${errorMessage}`,
      };
    }
  }

  async generateNote(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<any> {
    const model = this.genAI.getGenerativeModel({
      model: options.model || 'gemini-1.5-pro',
      generationConfig: {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 1000,
      },
    });

    const prompt = this.buildPrompt(options);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Capture token usage for billing
    const usageMetadata = response.usageMetadata;
    if (usageMetadata) {
      this.lastTokenUsage = {
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      };
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      // Fallback to raw text if JSON parsing fails
      return { content: text };
    }
  }

  // ===========================================================================
  // IMAGE ANALYSIS (Vision)
  // ===========================================================================

  private static readonly ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  private static readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024;
  private static readonly IMAGE_MIME_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  async analyzeImage(
    filePath: string,
    context?: string,
    language?: string,
  ): Promise<{ text: string }> {
    this.logger.log(`Starting image analysis: ${filePath}`);

    // Validate
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!GeminiStrategy.ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported image format: ${ext}`);
    }
    const stats = fs.statSync(filePath);
    if (stats.size > GeminiStrategy.MAX_IMAGE_SIZE) {
      throw new Error(`Image file too large: ${(stats.size / (1024 * 1024)).toFixed(1)} MB. Maximum: 20 MB`);
    }

    const mimeType = GeminiStrategy.IMAGE_MIME_MAP[ext] || 'image/jpeg';
    const base64 = fs.readFileSync(filePath).toString('base64');

    const prompt = `You are a medical document and image analysis specialist. Analyze the provided image and extract ALL visible text, data, and clinical findings.

INSTRUCTIONS:
1. If this is a document (lab result, prescription, handwritten note, referral letter): Extract ALL text exactly as written, preserving structure and formatting.
2. If this is a clinical image (X-ray, ultrasound, CT scan, photo of wound/condition): Describe visible clinical findings in professional medical terminology.
3. Preserve all numerical values, units, dates, and reference ranges.
4. Maintain the original structure (tables, lists, sections) as closely as possible.
5. Flag any values that appear abnormal or out of range.
6. Do NOT add interpretations or diagnoses beyond what is visible.
${language && language !== 'en' ? `7. Output language: ${language}` : ''}
${context ? `\nAdditional context from the doctor: ${context}` : ''}

Analyze this medical image and extract all relevant content.`;

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-pro',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    });

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64,
          mimeType,
        },
      },
    ]);

    const response = await result.response;

    // Token usage
    const usageMetadata = response.usageMetadata;
    if (usageMetadata) {
      this.lastTokenUsage = {
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      };
    }

    const text = response.text()?.trim();
    if (!text) {
      throw new Error('Image analysis returned empty content');
    }

    this.logger.log(`Image analysis complete, output length=${text.length}`);
    return { text };
  }

  private buildPrompt(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
  }): string {
    return `Generate a medical ${options.noteType} note in JSON format based on the following content:

Content:
${options.content}

${
  options.template
    ? `Template Structure:
${JSON.stringify(options.template, null, 2)}`
    : ''
}

Return only valid JSON without any additional commentary or markdown.`;
  }
}
