#!/usr/bin/env node

/**
 * DALL-E Image Generation Script for Aztec Chess
 *
 * Usage:
 *   node scripts/generate-image.js --prompt "A cute king chess piece..." --output app/assets/pieces/white/king.png
 *   node scripts/generate-image.js --piece king --color white
 *   node scripts/generate-image.js --all
 *
 * Environment:
 *   OPENAI_API_KEY - Required API key for DALL-E
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const CONFIG = {
  model: 'dall-e-3',
  size: '1024x1024',
  quality: 'hd',
  style: 'vivid',
  outputDir: path.join(__dirname, '..', 'app', 'assets'),
};

// Aztec brand colors for reference in prompts
const COLORS = {
  white: {
    base: 'cream/beige/parchment (#F2EEE1)',
    accent: 'bright yellow-green/chartreuse (#D4FF28)',
  },
  black: {
    base: 'very dark brown/ink (#1A1400)',
    accent: 'bright magenta/orchid (#FF2DF4)',
  },
};

// Piece personalities and visual descriptions
const PIECE_BRIEFS = {
  king: {
    personality: 'worried, overwhelmed, anxious',
    visual: 'tiny golden crown that is comically too big and tilts to one side, nervous wide eyes looking around worriedly, slight frown',
  },
  queen: {
    personality: 'smug, confident, sassy',
    visual: 'elegant tiara/crown, half-lidded confident eyes, subtle smirk, regal posture',
  },
  rook: {
    personality: 'stoic, confused, simple',
    visual: 'castle/tower shape with brick pattern texture, vacant stare, completely neutral expression, sturdy and blocky',
  },
  bishop: {
    personality: 'scheming, sneaky, mischievous',
    visual: 'pointy bishop hat/mitre tilted askew, sly side-eye expression, one eyebrow raised, slight grin',
  },
  knight: {
    personality: 'derpy, goofy, lovably dumb',
    visual: 'horse head shape, tongue slightly sticking out, slightly crossed eyes, dopey happy expression',
  },
  pawn: {
    personality: 'eager, innocent, clueless',
    visual: 'small round body, very wide innocent eyes, tiny determined expression, looks ready to help but confused',
  },
};

/**
 * Generate a DALL-E prompt for a chess piece
 */
function generatePiecePrompt(piece, color) {
  const brief = PIECE_BRIEFS[piece];
  const colorScheme = COLORS[color];

  return `A cute ${piece} chess piece in kawaii felt wool plush toy style, with big expressive googly eyes and a ${brief.personality} expression. ${brief.visual}. The piece has soft rounded edges like a handmade felt craft, with visible fuzzy wool texture. Colored in ${colorScheme.base} with subtle ${colorScheme.accent} accent details. Simple iconic chess piece silhouette. Isolated on a pure transparent background, centered, game asset style, high detail, soft lighting.`;
}

/**
 * Call DALL-E API to generate an image
 */
async function generateImage(prompt, outputPath) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  console.log(`\nGenerating image...`);
  console.log(`Prompt: ${prompt.substring(0, 100)}...`);

  const requestBody = JSON.stringify({
    model: CONFIG.model,
    prompt: prompt,
    n: 1,
    size: CONFIG.size,
    quality: CONFIG.quality,
    style: CONFIG.style,
    response_format: 'url',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';

      res.on('data', chunk => { data += chunk; });

      res.on('end', async () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API error (${res.statusCode}): ${data}`));
          return;
        }

        try {
          const response = JSON.parse(data);
          const imageUrl = response.data[0].url;
          const revisedPrompt = response.data[0].revised_prompt;

          console.log(`Image generated successfully!`);
          if (revisedPrompt && revisedPrompt !== prompt) {
            console.log(`Revised prompt: ${revisedPrompt.substring(0, 100)}...`);
          }

          // Download the image
          await downloadImage(imageUrl, outputPath);
          resolve({ url: imageUrl, revisedPrompt, outputPath });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

/**
 * Download image from URL to local file
 */
function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(outputPath);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log(`Saved to: ${outputPath}`);
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`Saved to: ${outputPath}`);
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {}); // Delete partial file
      reject(err);
    });
  });
}

/**
 * Generate all chess pieces
 */
async function generateAllPieces() {
  const pieces = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
  const colors = ['white', 'black'];

  console.log('Generating all chess pieces...\n');
  console.log('This will make 12 API calls to DALL-E.');
  console.log('Estimated cost: ~$4.80 (at $0.040 per image for HD 1024x1024)\n');

  const results = [];

  for (const color of colors) {
    for (const piece of pieces) {
      const prompt = generatePiecePrompt(piece, color);
      const outputPath = path.join(CONFIG.outputDir, 'pieces', color, `${piece}.png`);

      console.log(`\n--- ${color} ${piece} ---`);

      try {
        const result = await generateImage(prompt, outputPath);
        results.push({ piece, color, success: true, ...result });
      } catch (error) {
        console.error(`Failed to generate ${color} ${piece}: ${error.message}`);
        results.push({ piece, color, success: false, error: error.message });
      }

      // Rate limiting - wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n\n=== Generation Summary ===');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Success: ${successful.length}/12`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map(r => `${r.color} ${r.piece}`).join(', ')}`);
  }

  return results;
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--all') {
      result.all = true;
    } else if (arg === '--prompt' && args[i + 1]) {
      result.prompt = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      result.output = args[++i];
    } else if (arg === '--piece' && args[i + 1]) {
      result.piece = args[++i].toLowerCase();
    } else if (arg === '--color' && args[i + 1]) {
      result.color = args[++i].toLowerCase();
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    }
  }

  return result;
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Aztec Chess - DALL-E Image Generator

Usage:
  node scripts/generate-image.js --all
    Generate all 12 chess pieces (6 white + 6 black)

  node scripts/generate-image.js --piece <piece> --color <color>
    Generate a specific piece (king, queen, rook, bishop, knight, pawn)
    Color: white or black

  node scripts/generate-image.js --prompt "<prompt>" --output <path>
    Generate a custom image with a specific prompt

Options:
  --all              Generate all chess pieces
  --piece <piece>    Piece type (king, queen, rook, bishop, knight, pawn)
  --color <color>    Piece color (white, black)
  --prompt <text>    Custom DALL-E prompt
  --output <path>    Output file path
  --help, -h         Show this help message

Environment Variables:
  OPENAI_API_KEY     Required. Your OpenAI API key.

Examples:
  # Generate all pieces
  OPENAI_API_KEY=sk-... node scripts/generate-image.js --all

  # Generate just the white king
  OPENAI_API_KEY=sk-... node scripts/generate-image.js --piece king --color white

  # Custom prompt
  OPENAI_API_KEY=sk-... node scripts/generate-image.js \\
    --prompt "A cute pawn chess piece..." \\
    --output app/assets/pieces/white/pawn.png
`);
}

// Main execution
async function main() {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.all) {
    await generateAllPieces();
  } else if (args.piece && args.color) {
    if (!PIECE_BRIEFS[args.piece]) {
      console.error(`Invalid piece: ${args.piece}`);
      console.error(`Valid pieces: ${Object.keys(PIECE_BRIEFS).join(', ')}`);
      process.exit(1);
    }
    if (!['white', 'black'].includes(args.color)) {
      console.error(`Invalid color: ${args.color}`);
      console.error(`Valid colors: white, black`);
      process.exit(1);
    }

    const prompt = generatePiecePrompt(args.piece, args.color);
    const outputPath = path.join(CONFIG.outputDir, 'pieces', args.color, `${args.piece}.png`);

    await generateImage(prompt, outputPath);
  } else if (args.prompt && args.output) {
    await generateImage(args.prompt, args.output);
  } else {
    printUsage();
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
