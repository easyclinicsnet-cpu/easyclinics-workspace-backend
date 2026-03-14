import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AIProvider } from '../../../common/enums';
import { CareNoteType } from '../../../common/enums';
import { IAiGenerationStrategy } from '../interfaces/ai-generation-strategy.interface';
import { ChatCompletion } from 'openai/resources/chat';

@Injectable()
export class AnthropicStrategy implements IAiGenerationStrategy {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  generateStructuredTranscript(text: string, temperature: number, model: string, context: string): Promise<ChatCompletion> {
    throw new Error('Method not implemented.');
  }
  getSupportedModels(operation: 'transcription' | 'generation'): string[] {
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
