/**
 * Represents a chunk of audio file for parallel processing
 */
export interface AudioChunk {
  /**
   * Full path to the chunk file
   */
  path: string;

  /**
   * Index of this chunk in the sequence (0-based)
   */
  index: number;

  /**
   * Start time in seconds from the beginning of the original audio
   */
  startTime: number;

  /**
   * End time in seconds from the beginning of the original audio
   */
  endTime: number;

  /**
   * Duration of this chunk in seconds
   */
  duration: number;
}
