/**
 * AiWriting Feature Module Entry Point
 * 
 * Exports all public APIs of the AiWriting feature,
 * including components, extensions, and utility functions.
 */

import { AiWritingExtension } from './AiWritingExtension';

// Components are typically imported and used directly where needed
// AiWriting.vue is a UI component specific to this feature and likely used internally

// Uncomment and export if needed by other modules:
// import AiWriting from './ui/AiWriting.vue';

export {
  AiWritingExtension,
  // AiWriting,    // Uncomment if needed as a direct export for other features
};

// Default export for easy importing in editor factory
export default AiWritingExtension; 