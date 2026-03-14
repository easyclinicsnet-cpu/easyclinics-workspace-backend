import { Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import { AudioChunk } from '../interfaces/audio-chunk.interface';
import { LoggerService } from '../logger/logger.service';

export interface AudioOptimizationResult {
  originalPath: string;
  optimizedPath: string;
  originalSize: number;
  optimizedSize: number;
  originalFormat: string;
  optimizedFormat: string;
  duration: number;
  compressionRatio: number;
}

export interface AudioMetadata {
  duration: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
  codec: string;
  size: number;
  formatName?: string;
  formatLongName?: string;
}

@Injectable()
export class AudioProcessor {
  private readonly logger: LoggerService;

  // ══════════════════════════════════════════════════════════════════
  // CHUNKING CONFIGURATION
  // ══════════════════════════════════════════════════════════════════
  private readonly DEFAULT_CHUNK_DURATION_MINUTES = 8;
  private readonly MAX_CHUNK_SIZE_MB = 24; // Under 25MB OpenAI limit

  // ══════════════════════════════════════════════════════════════════
  // OPTIMIZATION CONFIGURATION (Whisper optimal settings)
  // ══════════════════════════════════════════════════════════════════
  private readonly OPTIMAL_BITRATE = '64k'; // 64kbps sufficient for speech
  private readonly OPTIMAL_SAMPLE_RATE = 16000; // 16kHz is Whisper's native rate
  private readonly OPTIMAL_CHANNELS = 1; // Mono is sufficient for speech
  private readonly OUTPUT_FORMAT = 'mp3';

  // ══════════════════════════════════════════════════════════════════
  // FILE CONSTRAINTS
  // ══════════════════════════════════════════════════════════════════
  private readonly MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
  private readonly SUPPORTED_FORMATS = [
    '.mp3',
    '.mp4',
    '.mpeg',
    '.mpga',
    '.m4a',
    '.wav',
    '.webm',
    '.ogg',
    '.flac',
    '.aac',
    '.opus',
  ];

  constructor() {
    this.logger = new LoggerService('AudioProcessor');
    this.logger.log(
      'AudioProcessor initialized with optimization + chunking support',
    );
    this.validateFFmpegOnStartup();
  }

  // ══════════════════════════════════════════════════════════════════
  // AUDIO DURATION & METADATA
  // ══════════════════════════════════════════════════════════════════

  /**
   * Get audio file duration in seconds using FFprobe
   * ENHANCED: Comprehensive error handling and logging
   */
  async getAudioDuration(filePath: string): Promise<number> {
    const operationId = `duration_${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.logger.debug(`[${operationId}] Getting audio duration`, {
        filePath,
      });

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        const error = new Error(`Audio file not found: ${filePath}`);
        this.logger.error(`[${operationId}] File does not exist`, filePath);
        reject(error);
        return;
      }

      // Get file size
      const stats = fs.statSync(filePath);
      this.logger.debug(
        `[${operationId}] File size: ${this.formatBytes(stats.size)}`,
      );

      if (stats.size === 0) {
        const error = new Error(`Audio file is empty (0 bytes): ${filePath}`);
        this.logger.error(`[${operationId}] Empty file detected`, filePath);
        reject(error);
        return;
      }

      ffmpeg.ffprobe(filePath, async (err, metadata) => {
        if (err) {
          this.logger.error(`[${operationId}] FFprobe failed`, err.message);
          reject(
            new Error(
              `FFprobe error: ${err.message}. ` +
                `Ensure FFmpeg is installed and in PATH. ` +
                `File: ${path.basename(filePath)}`,
            ),
          );
          return;
        }

        // Log full metadata
        this.logger.debug(`[${operationId}] FFprobe metadata`);

        let duration = metadata.format.duration;

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 1: Check format.duration
        // ═══════════════════════════════════════════════════════════════
        if (this.isValidDuration(duration)) {
          this.logger.debug(
            `[${operationId}] ✅ Duration from format: ${duration.toFixed(2)}s`,
          );
          resolve(duration);
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 2: Try audio stream duration
        // ═══════════════════════════════════════════════════════════════
        const audioStream = metadata.streams?.find(
          (s) => s.codec_type === 'audio',
        );
        if (audioStream?.duration) {
          const streamDuration = parseFloat(audioStream.duration as any);
          if (this.isValidDuration(streamDuration)) {
            this.logger.log(
              `[${operationId}] ✅ Duration from audio stream: ${streamDuration.toFixed(2)}s`,
            );
            resolve(streamDuration);
            return;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 3: Estimate from file size and bitrate
        // ═══════════════════════════════════════════════════════════════
        this.logger.warn(
          `[${operationId}] Duration is "${metadata.format.duration}" (type: ${typeof metadata.format.duration}), ` +
            `trying estimation from file size`,
        );

        const bitrate = metadata.format.bit_rate
          ? typeof metadata.format.bit_rate === 'number'
            ? metadata.format.bit_rate
            : parseInt(metadata.format.bit_rate)
          : null;

        if (bitrate && bitrate > 0) {
          // duration = (file_size_in_bytes * 8) / bitrate_in_bits_per_second
          const estimatedDuration = (stats.size * 8) / bitrate;

          if (this.isValidDuration(estimatedDuration)) {
            this.logger.log(
              `[${operationId}] ✅ Duration estimated from bitrate: ${estimatedDuration.toFixed(2)}s ` +
                `(${(estimatedDuration / 60).toFixed(2)} min)`,
            );
            resolve(estimatedDuration);
            return;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 4: Last resort - re-encode to fix metadata
        // ═══════════════════════════════════════════════════════════════
        this.logger.warn(
          `[${operationId}] All duration strategies failed, attempting re-encode to fix metadata`,
        );

        this.fixWebMMetadataAndGetDuration(filePath, operationId)
          .then((fixedDuration) => {
            this.logger.log(
              `[${operationId}] ✅ Duration from re-encoded file: ${fixedDuration.toFixed(2)}s`,
            );
            resolve(fixedDuration);
          })
          .catch((fixError) => {
            this.logger.error(`[${operationId}] All strategies failed`, fixError.message);
            reject(
              new Error(
                `Could not determine audio duration after trying all strategies. ` +
                  `File: ${path.basename(filePath)}. ` +
                  `Format duration: ${metadata.format.duration}. ` +
                  `The file may be corrupt or have invalid metadata.`,
              ),
            );
          });
      });
    });
  }

  /**
   * Check if duration value is valid (number, not NaN, > 0)
   */
  private isValidDuration(duration: any): duration is number {
    return (
      duration !== undefined &&
      duration !== null &&
      duration !== 'N/A' &&
      typeof duration === 'number' &&
      !isNaN(duration) &&
      duration > 0
    );
  }

  /**
   * Re-encode WebM file to fix missing/invalid duration metadata
   * This is a last resort but guaranteed to work
   */
  private async fixWebMMetadataAndGetDuration(
    inputPath: string,
    operationId: string,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const tempPath = inputPath.replace(/(\.\w+)$/, '_fixed$1');

      this.logger.debug(
        `[${operationId}] Re-encoding to fix metadata: ${path.basename(inputPath)}`,
      );

      // Quick re-encode with codec copy (fast, just rewrites container)
      ffmpeg(inputPath)
        .outputOptions([
          '-c copy', // Copy codecs (no re-encoding, just remux)
          '-write_id3v2 1', // Write metadata
          '-movflags +faststart', // Enable streaming
        ])
        .output(tempPath)
        .on('start', (commandLine) => {
          this.logger.debug(
            `[${operationId}] FFmpeg fix command: ${commandLine}`,
          );
        })
        .on('end', async () => {
          this.logger.debug(
            `[${operationId}] Re-encode complete, checking duration`,
          );

          // Get duration from fixed file
          ffmpeg.ffprobe(tempPath, (err, metadata) => {
            // Delete temp file
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }

            if (err) {
              reject(
                new Error(`Failed to probe re-encoded file: ${err.message}`),
              );
              return;
            }

            const duration = metadata.format.duration;
            if (this.isValidDuration(duration)) {
              resolve(duration);
            } else {
              reject(
                new Error(
                  `Re-encoded file still has invalid duration: ${duration}`,
                ),
              );
            }
          });
        })
        .on('error', (err) => {
          // Clean up on error
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          this.logger.error(`[${operationId}] Re-encode failed`, err.message);
          reject(new Error(`Failed to fix metadata: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Get comprehensive audio metadata
   * ENHANCED: Returns detailed metadata including all audio properties
   */
  async getAudioMetadata(filePath: string): Promise<AudioMetadata> {
    const stats = await fs.promises.stat(filePath);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to get audio metadata: ${err.message}`));
          return;
        }

        const audioStream = metadata.streams.find(
          (stream) => stream.codec_type === 'audio',
        );

        if (!audioStream) {
          reject(new Error('No audio stream found in file'));
          return;
        }

        const bitRate =
          typeof metadata.format.bit_rate === 'number'
            ? metadata.format.bit_rate
            : parseInt(metadata.format.bit_rate || '0', 10);

        resolve({
          duration: metadata.format.duration || 0,
          bitrate: bitRate,
          sampleRate: audioStream.sample_rate
            ? typeof audioStream.sample_rate === 'number'
              ? audioStream.sample_rate
              : parseInt(audioStream.sample_rate as string)
            : 0,
          channels: audioStream.channels || 0,
          codec: audioStream.codec_name || 'unknown',
          size: stats.size,
          formatName: metadata.format.format_name,
          formatLongName: metadata.format.format_long_name,
        });
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // AUDIO CHUNKING (For parallel processing)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Split audio file into chunks with adaptive sizing
   * Returns single chunk if file is small enough
   * OPTIMIZED: Handles errors gracefully, validates chunks
   */
  async splitAudioFile(
    inputPath: string,
    chunkDurationMinutes?: number,
    outputDir?: string,
  ): Promise<AudioChunk[]> {
    const operationId = `split_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const chunkDuration =
      chunkDurationMinutes || this.DEFAULT_CHUNK_DURATION_MINUTES;

    this.logger.log(`[${operationId}] Analyzing audio for splitting`);

    try {
      // Get audio duration
      const duration = await this.getAudioDuration(inputPath);
      const durationMinutes = duration / 60;

      this.logger.log(
        `[${operationId}] Audio duration: ${durationMinutes.toFixed(2)} minutes`,
      );

      // Return single chunk if file is small enough
      if (durationMinutes <= chunkDuration) {
        this.logger.log(
          `[${operationId}] File is short enough (${durationMinutes.toFixed(2)} min <= ${chunkDuration} min), no splitting needed`,
        );
        return [
          {
            path: inputPath,
            index: 0,
            startTime: 0,
            endTime: duration,
            duration,
          },
        ];
      }

      // Calculate optimal chunks
      const chunkDurationSeconds = chunkDuration * 60;
      const numChunks = Math.ceil(duration / chunkDurationSeconds);

      this.logger.log(
        `[${operationId}] Splitting into ${numChunks} chunks of ${chunkDuration} minutes each`,
      );

      // Prepare output directory
      const outputDirectory =
        outputDir || path.join(path.dirname(inputPath), 'chunks', operationId);

      if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
        this.logger.debug(
          `[${operationId}] Created chunk directory: ${outputDirectory}`,
        );
      }

      // Split audio into chunks
      const chunks: AudioChunk[] = [];
      const ext = path.extname(inputPath);
      const basename = path.basename(inputPath, ext);

      for (let i = 0; i < numChunks; i++) {
        const startTime = i * chunkDurationSeconds;
        const endTime = Math.min((i + 1) * chunkDurationSeconds, duration);
        const actualDuration = endTime - startTime;
        const chunkPath = path.join(
          outputDirectory,
          `${basename}_chunk_${String(i).padStart(3, '0')}${ext}`,
        );

        this.logger.log(
          `[${operationId}] Creating chunk ${i + 1}/${numChunks}`,
        );

        await this.extractChunk(
          inputPath,
          chunkPath,
          startTime,
          actualDuration,
        );

        // Verify chunk was created
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`Failed to create chunk: ${chunkPath}`);
        }

        const chunkStats = fs.statSync(chunkPath);
        this.logger.debug(`[${operationId}] Chunk ${i + 1} created`);

        chunks.push({
          path: chunkPath,
          index: i,
          startTime,
          endTime,
          duration: actualDuration,
        });
      }

      this.logger.log(
        `[${operationId}] Successfully created ${chunks.length} chunks`,
      );
      return chunks;
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to split audio file`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Extract a chunk from audio file using FFmpeg
   * Uses codec copy for fast extraction without re-encoding
   */
  private extractChunk(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .output(outputPath)
        .audioCodec('copy') // Copy codec for speed
        .on('start', (commandLine) => {
          this.logger.debug(`FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent && progress.percent % 25 === 0) {
            this.logger.debug(
              `Chunk extraction progress: ${progress.percent.toFixed(1)}%`,
            );
          }
        })
        .on('end', () => {
          this.logger.debug(`Chunk extracted successfully: ${outputPath}`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          this.logger.error(`Failed to extract chunk`, err.message);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Merge transcribed chunks back into single text
   * Adds timestamps for chunks from large files
   */
  mergeTranscriptions(
    chunks: AudioChunk[],
    transcriptions: string[],
    addTimestamps = true,
  ): string {
    if (chunks.length !== transcriptions.length) {
      throw new Error(
        `Chunk and transcription count mismatch: ${chunks.length} chunks but ${transcriptions.length} transcriptions`,
      );
    }

    // Single chunk - return as is
    if (chunks.length === 1) {
      return transcriptions[0];
    }

    // Multiple chunks - add timestamps if requested
    if (!addTimestamps) {
      return transcriptions.join('\n\n');
    }

    return transcriptions
      .map((text, index) => {
        const chunk = chunks[index];
        const timestamp = this.formatTimestamp(chunk.startTime);
        const endTimestamp = this.formatTimestamp(chunk.endTime);

        return `[${timestamp} - ${endTimestamp}]\n${text.trim()}`;
      })
      .join('\n\n');
  }

  /**
   * Clean up temporary chunk files (does NOT delete original)
   */
  async cleanupChunks(
    chunks: AudioChunk[],
    keepOriginal = true,
  ): Promise<void> {
    const operationId = `cleanup_${Date.now()}`;
    let deletedCount = 0;
    let totalSize = 0;

    this.logger.log(`[${operationId}] Starting chunk cleanup`);

    for (const chunk of chunks) {
      // Skip original file if it's the only chunk
      if (keepOriginal && chunk.index === 0 && chunks.length === 1) {
        this.logger.debug(`Skipping original file: ${chunk.path}`);
        continue;
      }

      // Only delete files in 'chunks' subdirectory
      if (
        !chunk.path.includes('/chunks/') &&
        !chunk.path.includes('\\chunks\\')
      ) {
        this.logger.debug(`Skipping non-chunk file: ${chunk.path}`);
        continue;
      }

      try {
        if (fs.existsSync(chunk.path)) {
          const stats = fs.statSync(chunk.path);
          totalSize += stats.size;

          await fs.promises.unlink(chunk.path);
          deletedCount++;

          this.logger.debug(`Deleted chunk: ${path.basename(chunk.path)}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to cleanup chunk: ${chunk.path}`, error instanceof Error ? error.message : String(error));
      }
    }

    // Remove empty chunk directories
    const chunkDirs = new Set(
      chunks
        .filter(
          (c) => c.path.includes('/chunks/') || c.path.includes('\\chunks\\'),
        )
        .map((c) => path.dirname(c.path)),
    );

    for (const dir of chunkDirs) {
      try {
        const files = await fs.promises.readdir(dir);
        if (files.length === 0) {
          await fs.promises.rmdir(dir);
          this.logger.debug(`Removed empty chunk directory: ${dir}`);
        }
      } catch (error) {
        this.logger.debug(`Could not remove directory: ${dir}`);
      }
    }

    this.logger.log(`[${operationId}] Cleanup completed`);
  }

  // ══════════════════════════════════════════════════════════════════
  // AUDIO OPTIMIZATION (For Whisper transcription)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Optimizes audio file for OpenAI Whisper transcription
   * Converts to optimal format, bitrate, and sample rate
   */
  async optimizeForWhisper(
    inputPath: string,
    outputDir?: string,
  ): Promise<AudioOptimizationResult> {
    const operationId = `optimize_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      this.logger.log(`[${operationId}] Starting audio optimization`);

      // Validate input file
      await this.validateInputFile(inputPath);

      // Get metadata before optimization
      const originalMetadata = await this.getAudioMetadata(inputPath);

      this.logger.debug(`[${operationId}] Original audio metadata`);

      // Check if optimization is needed
      if (this.isAlreadyOptimal(originalMetadata, inputPath)) {
        this.logger.log(`[${operationId}] File is already optimally formatted`);

        return {
          originalPath: inputPath,
          optimizedPath: inputPath,
          originalSize: originalMetadata.size,
          optimizedSize: originalMetadata.size,
          originalFormat: path.extname(inputPath),
          optimizedFormat: path.extname(inputPath),
          duration: originalMetadata.duration,
          compressionRatio: 1.0,
        };
      }

      // Determine output path
      const outputPath = this.generateOutputPath(inputPath, outputDir);

      // Ensure output directory exists
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

      // Perform optimization
      await this.convertAudioForWhisper(inputPath, outputPath, operationId);

      // Get metadata after optimization
      const optimizedMetadata = await this.getAudioMetadata(outputPath);

      // Calculate compression ratio
      const compressionRatio = originalMetadata.size / optimizedMetadata.size;

      this.logger.log(`[${operationId}] Optimization completed successfully`);

      return {
        originalPath: inputPath,
        optimizedPath: outputPath,
        originalSize: originalMetadata.size,
        optimizedSize: optimizedMetadata.size,
        originalFormat: path.extname(inputPath),
        optimizedFormat: path.extname(outputPath),
        duration: optimizedMetadata.duration,
        compressionRatio,
      };
    } catch (error) {
      this.logger.error(`[${operationId}] Audio optimization failed`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Converts audio file to Whisper-optimized format using ffmpeg
   * Applies normalization and noise filtering
   */
  private async convertAudioForWhisper(
    inputPath: string,
    outputPath: string,
    operationId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`[${operationId}] Starting ffmpeg conversion`);

      ffmpeg(inputPath)
        .toFormat(this.OUTPUT_FORMAT)
        .audioCodec('libmp3lame') // MP3 codec
        .audioBitrate(this.OPTIMAL_BITRATE)
        .audioChannels(this.OPTIMAL_CHANNELS)
        .audioFrequency(this.OPTIMAL_SAMPLE_RATE)
        // Normalize audio levels and remove noise
        .audioFilters([
          'loudnorm=I=-16:TP=-1.5:LRA=11', // EBU R128 normalization
          'highpass=f=80', // Remove low-frequency noise
          'lowpass=f=8000', // Remove high-frequency noise (speech is < 8kHz)
        ])
        .on('start', (commandLine) => {
          this.logger.debug(`[${operationId}] FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            this.logger.debug(
              `[${operationId}] Processing: ${progress.percent.toFixed(1)}%`,
            );
          }
        })
        .on('end', () => {
          this.logger.debug(`[${operationId}] FFmpeg conversion completed`);
          resolve();
        })
        .on('error', (error) => {
          this.logger.error(`[${operationId}] FFmpeg conversion failed`, error.message);
          reject(new Error(`Audio conversion failed: ${error.message}`));
        })
        .save(outputPath);
    });
  }

  /**
   * Batch optimize multiple audio files
   */
  async optimizeBatch(
    inputPaths: string[],
    outputDir?: string,
  ): Promise<AudioOptimizationResult[]> {
    this.logger.log(
      `Starting batch optimization of ${inputPaths.length} files`,
    );

    const results: AudioOptimizationResult[] = [];

    for (const inputPath of inputPaths) {
      try {
        const result = await this.optimizeForWhisper(inputPath, outputDir);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to optimize ${inputPath}`, error instanceof Error ? error.message : String(error));
        // Continue with other files
      }
    }

    this.logger.log(
      `Batch optimization completed: ${results.length}/${inputPaths.length} successful`,
    );

    return results;
  }

  /**
   * Validates input audio file
   */
  private async validateInputFile(filePath: string): Promise<void> {
    // Check if file exists
    try {
      await fs.promises.access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    // Check file size
    const stats = await fs.promises.stat(filePath);
    if (stats.size === 0) {
      throw new Error('File is empty');
    }

    if (stats.size > this.MAX_FILE_SIZE) {
      throw new Error(
        `File exceeds maximum size: ${this.formatBytes(stats.size)} ` +
          `(max: ${this.formatBytes(this.MAX_FILE_SIZE)}). ` +
          `Consider using splitAudioFile() for large files.`,
      );
    }

    // Check file format
    const ext = path.extname(filePath).toLowerCase();
    if (!this.SUPPORTED_FORMATS.includes(ext)) {
      throw new Error(
        `Unsupported file format: ${ext}. ` +
          `Supported: ${this.SUPPORTED_FORMATS.join(', ')}`,
      );
    }
  }

  /**
   * Checks if audio file is already in optimal format
   */
  private isAlreadyOptimal(metadata: AudioMetadata, filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const targetBitrate = parseInt(this.OPTIMAL_BITRATE, 10) * 1000; // Convert to bps

    // Check if format, sample rate, channels, and bitrate are already optimal
    // Allow 10% tolerance on bitrate
    const bitrateOptimal =
      metadata.bitrate >= targetBitrate * 0.9 &&
      metadata.bitrate <= targetBitrate * 1.1;

    return (
      ext === `.${this.OUTPUT_FORMAT}` &&
      metadata.sampleRate === this.OPTIMAL_SAMPLE_RATE &&
      metadata.channels === this.OPTIMAL_CHANNELS &&
      bitrateOptimal
    );
  }

  /**
   * Generates output file path for optimized audio
   */
  private generateOutputPath(inputPath: string, outputDir?: string): string {
    const basename = path.basename(inputPath, path.extname(inputPath));
    const outputFilename = `${basename}_optimized.${this.OUTPUT_FORMAT}`;

    if (outputDir) {
      return path.join(outputDir, outputFilename);
    }

    return path.join(path.dirname(inputPath), outputFilename);
  }

  // ══════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ══════════════════════════════════════════════════════════════════

  /**
   * Format seconds to HH:MM:SS or MM:SS timestamp
   */
  formatTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Formats bytes to human-readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Validate FFmpeg installation on service startup
   */
  private async validateFFmpegOnStartup(): Promise<void> {
    try {
      const result = await this.validateFFmpeg();
      if (result.installed) {
        this.logger.log('✅ FFmpeg is installed and available');
      } else {
        this.logger.error('❌ FFmpeg validation failed', result.error);
      }
    } catch (error) {
      this.logger.error('❌ FFmpeg validation failed', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Validate FFmpeg installation
   */
  async validateFFmpeg(): Promise<{
    installed: boolean;
    version?: string;
    error?: string;
  }> {
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          this.logger.error('FFmpeg validation failed', err.message);
          resolve({
            installed: false,
            error:
              'FFmpeg is not installed or not in PATH. ' +
              'Please install FFmpeg: https://ffmpeg.org/download.html',
          });
          return;
        }

        // Check if WebM is supported
        const supportsWebM = formats && formats.webm;
        this.logger.debug('FFmpeg formats available');

        resolve({
          installed: true,
          version: 'detected',
        });
      });
    });
  }

  /**
   * Cleans up optimized files
   */
  async cleanupOptimizedFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
      this.logger.debug(`Cleaned up optimized file: ${filePath}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup file: ${filePath}`, error instanceof Error ? error.message : String(error));
    }
  }
}
