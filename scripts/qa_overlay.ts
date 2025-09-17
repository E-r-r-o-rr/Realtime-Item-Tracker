#!/usr/bin/env node
/*
 * CLI tool for visual QA overlay. Given a floor and optional section, it
 * retrieves the corresponding map from the map index and renders an overlay
 * highlighting the target section. This script relies on the Sharp library
 * to composite images. Because we do not have precise section coordinates,
 * the overlay simply draws a semi-transparent rectangle at the centre of
 * the image. In a production system you would encode section polygons and
 * compute their bounding boxes to draw accurate highlights (US 4.4).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { resolveMap } from '../src/lib/mapIndex';

async function main() {
  const args = process.argv.slice(2);
  let floor: string | undefined;
  let section: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--floor') floor = args[++i];
    else if (arg === '--section') section = args[++i];
    else if (arg === '--out') out = args[++i];
  }
  if (!floor) {
    console.error('Usage: qa_overlay --floor <floor> [--section <section>] [--out <output.png>]');
    process.exit(1);
  }
  const entry = resolveMap(floor, section);
  if (!entry) {
    console.error('Map not found for floor', floor, 'section', section ?? '(none)');
    process.exit(2);
  }
  const imagePath = entry.filePath;
  const image = sharp(imagePath);
  const { width, height } = await image.metadata();
  if (!width || !height) {
    console.error('Unable to read image dimensions');
    process.exit(3);
  }
  // Draw a red rectangle in the center occupying 30% of both dimensions
  const rectWidth = Math.round(width * 0.3);
  const rectHeight = Math.round(height * 0.3);
  const left = Math.round((width - rectWidth) / 2);
  const top = Math.round((height - rectHeight) / 2);
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect x="${left}" y="${top}" width="${rectWidth}" height="${rectHeight}"
            fill="red" fill-opacity="0.4" stroke="red" stroke-width="4" />
    </svg>`,
  );
  const composite = await image
    .composite([{ input: overlay, blend: 'over' }])
    .png()
    .toBuffer();
  const outputFile = out ?? `qa-${entry.key}.png`;
  fs.writeFileSync(outputFile, composite);
  console.log('QA overlay written to', outputFile);
}

main().catch((err) => {
  console.error(err);
});