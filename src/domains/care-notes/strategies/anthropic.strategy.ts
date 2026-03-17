import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../../../common/enums';
import { CareNoteType } from '../../../common/enums';
import { IAiGenerationStrategy, AiTokenUsage } from '../interfaces/ai-generation-strategy.interface';
import { ChatCompletion } from 'openai/resources/chat';

@Injectable()
export class AnthropicStrategy implements IAiGenerationStrategy {
  private readonly logger = new Logger('AnthropicStrategy');
  private anthropic: Anthropic;
  private lastTokenUsage: AiTokenUsage | null = null;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
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
      await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Ping' }],
      });
      return { healthy: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        healthy: false,
        details: `Anthropic API health check failed: ${errorMessage}`,
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
    const prompt = this.buildPrompt(options);

    const completion = await this.anthropic.messages.create({
      model: options.model || 'claude-3-opus-20240229',
      max_tokens: options.maxTokens || 1000,
      temperature: options.temperature || 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    // Capture token usage for billing
    if (completion.usage) {
      this.lastTokenUsage = {
        inputTokens: completion.usage.input_tokens || 0,
        outputTokens: completion.usage.output_tokens || 0,
        totalTokens: (completion.usage.input_tokens || 0) + (completion.usage.output_tokens || 0),
      };
    }

    // Get the first content block that has text
    const content = completion.content.find((block) => 'text' in block);

    if (!content) {
      throw new Error('No text content found in the response');
    }

    try {
      return JSON.parse(content.text);
    } catch (e) {
      // Fallback to raw text if JSON parsing fails
      return { content: content.text };
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
    if (!AnthropicStrategy.ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported image format: ${ext}`);
    }
    const stats = fs.statSync(filePath);
    if (stats.size > AnthropicStrategy.MAX_IMAGE_SIZE) {
      throw new Error(`Image file too large: ${(stats.size / (1024 * 1024)).toFixed(1)} MB. Maximum: 20 MB`);
    }

    const mimeType = AnthropicStrategy.IMAGE_MIME_MAP[ext] || 'image/jpeg';
    const base64 = fs.readFileSync(filePath).toString('base64');

    const systemPrompt = `You are a medical document and image analysis specialist. Analyze the provided image and extract ALL visible text, data, and clinical findings.

INSTRUCTIONS:
1. If this is a document (lab result, prescription, handwritten note, referral letter): Extract ALL text exactly as written, preserving structure and formatting.
2. If this is a clinical image (X-ray, ultrasound, CT scan, photo of wound/condition): Describe visible clinical findings in professional medical terminology.
3. Preserve all numerical values, units, dates, and reference ranges.
4. Maintain the original structure (tables, lists, sections) as closely as possible.
5. Flag any values that appear abnormal or out of range.
6. Do NOT add interpretations or diagnoses beyond what is visible.
${language && language !== 'en' ? `7. Output language: ${language}` : ''}
${context ? `\nAdditional context from the doctor: ${context}` : ''}`;

    const completion = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            {
              type: 'text',
              text: 'Analyze this medical image and extract all relevant content.',
            },
          ],
        },
      ],
    });

    // Token usage
    if (completion.usage) {
      this.lastTokenUsage = {
        inputTokens: completion.usage.input_tokens || 0,
        outputTokens: completion.usage.output_tokens || 0,
        totalTokens: (completion.usage.input_tokens || 0) + (completion.usage.output_tokens || 0),
      };
    }

    const textBlock = completion.content.find((block) => 'text' in block);
    if (!textBlock || !('text' in textBlock)) {
      throw new Error('Image analysis returned no text content');
    }

    this.logger.log(`Image analysis complete, output length=${textBlock.text.length}`);
    return { text: textBlock.text };
  }

  private buildPrompt(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
  }): string {
    // Similar to OpenAI but tailored for Claude's preferred format
    return `\n\nHuman: Generate a medical ${options.noteType} note in JSON format based on the following content:
    
Content:
${options.content}

${
  options.template
    ? `Template Structure:
${JSON.stringify(options.template, null, 2)}`
    : ''
}

Return only valid JSON without any additional commentary or markdown.

Assistant: Understood. Here's the medical note in valid JSON format:`;
  }
}
