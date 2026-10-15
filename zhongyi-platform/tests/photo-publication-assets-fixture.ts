import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePhotoDerivative } from '../server/photo-derivative-preparation.js';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import { PhotoDerivativeRegistry } from '../server/photo-derivative-registry.js';
import { PhotoPublicationJournal } from '../server/photo-publication-journal.js';
import { writeNewPhotoFile } from '../server/photo-resource-backup.js';

// Frozen real JPEG colour block captured by the existing Canvas fixture.
// Not a food photo. No browser dependency in PostgreSQL storage tests.
// Capture: 2026-10-13, run-qAByFC, Canvas encoder 153.0.4234.32.
const originalBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAwAGADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCgAQxYwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/2Q==";
const displayBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUEBAQEAwUEBAQGBQUGCA0ICAcHCBALDAkNExAUExIQEhIUFx0ZFBYcFhISGiMaHB4fISEhFBkkJyQgJh0gISD/2wBDAQUGBggHCA8ICA8gFRIVICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICD/wAARCAAwAGADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ApgM6XYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/9k=";
const metadataValue: unknown = {
  "schemaVersion": "private-photo-derivative.1",
  "candidate": {
    "id": "fixture-photo-note",
    "ingredientId": "huang-qi",
    "name": "工程模拟候选，非食材照片",
    "sourcePage": "https://commons.wikimedia.org/wiki/File:Fixture.jpg",
    "sourceRevision": "1",
    "author": "Test fixture",
    "declaredLicense": "CC0-1.0",
    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "observation": "仅测试，不作食材鉴定。",
    "concerns": [
      "测试材料不可公开。"
    ],
    "sha256": "sha256:d78c56b0baf776c51182e96f0e0ab7e0d8a630f24e879f046a648b68686a5093",
    "bytes": 787,
    "width": 96,
    "height": 48,
    "identityReview": "pending",
    "processingReview": "pending",
    "rightsReview": "pending",
    "professionalReview": "pending",
    "originalMetadataRetained": true,
    "publicationEligible": false
  },
  "bindingDigest": "sha256:4473cef017d635774af0bcd3e55117f4a6dc8e4d1bd95403d0124549667985cd",
  "assetFilename": "bf3de092d0b92866e1dc56a1f3a50335346a310d7948065b431b4b311f510e6f.jpg",
  "sha256": "sha256:bf3de092d0b92866e1dc56a1f3a50335346a310d7948065b431b4b311f510e6f",
  "bytes": 314,
  "width": 96,
  "height": 48,
  "pipeline": "canvas-jpeg.v1",
  "encoderVersion": "153.0.4234.32",
  "decodedWidth": 96,
  "decodedHeight": 48,
  "maxEdge": 1280,
  "quality": 0.84,
  "orientation": "from-image",
  "crop": "none",
  "generativeEdit": false,
  "metadataPolicy": "jfif-only-no-thumbnail",
  "transformationNotice": "依据原图方向等比例缩放并重新编码为JPEG；未裁切、未使用生成式修改。附加元数据不保留，画面可见信息另行审核。",
  "licenseReview": "pending",
  "visualPrivacyReview": "pending",
  "derivativeReview": "pending",
  "publicationEligible": false,
  "preparedAt": "2026-10-13T04:46:42.864Z",
  "digest": "sha256:c4597dbd0882e3db48316d94946591b50a92056c6bf494b8a9df8c2ee744c2cb"
};

export function createSyntheticPublicationAssets() {
  const original = Buffer.from(originalBase64, 'base64'), display = Buffer.from(displayBase64, 'base64');
  const metadata = validatePhotoDerivative(metadataValue, display), photo = metadata.candidate;
  if (original.length !== photo.bytes || 'sha256:' + createHash('sha256').update(original).digest('hex') !== photo.sha256) throw new Error('Frozen original checksum mismatch');
  const parent = resolve('.local/postgres-photo-publication-tests'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(resolve(parent, 'run-'));
  for (const name of ['originals', 'derivatives', 'journal']) mkdirSync(resolve(root, name));
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 'private-photo-preview.1', items: [{ ...photo, localPath: 'original.jpg' }] }));
  writeNewPhotoFile(resolve(root, 'originals/manifest.json'), manifest); writeNewPhotoFile(resolve(root, 'originals/original.jpg'), original);
  writeNewPhotoFile(resolve(root, 'derivatives', metadata.assetFilename), display);
  writeNewPhotoFile(resolve(root, 'derivatives/bundle.json'), Buffer.from(JSON.stringify({
    schemaVersion: 'private-photo-derivative-bundle.1', preparedAt: metadata.preparedAt, encoderVersion: metadata.encoderVersion,
    originalManifestDigest: createHash('sha256').update(manifest).digest('hex'), publicationEligible: false, items: [metadata]
  })));
  const originals = new PrivatePhotoRegistry(resolve(root, 'originals'), resolve(root, 'originals/manifest.json'));
  const derivatives = new PhotoDerivativeRegistry(resolve(root, 'derivatives'), originals), journal = new PhotoPublicationJournal(resolve(root, 'journal'));
  return { root, original, display, metadata, photo, originals, derivatives, journal };
}

