import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CareNoteType } from '../../../common/enums';
import { IAiGenerationStrategy } from '../interfaces/ai-generation-strategy.interface';
import { ChatCompletion } from 'openai/resources/chat';
import { AIProvider } from '../../../common/enums';

@Injectable()
export class GeminiStrategy implements IAiGenerationStrategy {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
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

    try {
      return JSON.parse(text);
    } catch (e) {
      // Fallback to raw text if JSON parsing fails
      return { content: text };
    }
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
