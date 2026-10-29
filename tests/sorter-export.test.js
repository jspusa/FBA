const assert = require('node:assert/strict');
const test = require('node:test');

function batchFiles() {
  return new Map([
    ['FBA456', { files:new Map([['Pallet-FBA456.pdf', new Blob(['pallet'])]]) }],
    ['FBA123', { files:new Map([
      ['BOL-FBA123.pdf', new Blob(['bill'])],
      ['FBA123.csv', new Blob(['csv'])],
      ['FBA123-box.pdf', new Blob(['boxes'])],
    ]) }],
  ]);
}

function fakeDirectory(name = 'Downloads', files = new Map()) {
  const entries = new Map();
  return {
    name,
    entries,
    async getDirectoryHandle(child, options = {}) {
      if (!entries.has(child)) {
        if (!options.create) throw Object.assign(new Error('Missing'), { name:'NotFoundError' });
        entries.set(child, fakeDirectory(child, files));
      }
      return entries.get(child);
    },
    async getFileHandle(filename) {
      return { createWritable:async () => {
        let bytes;
        return {
          async write(value) { bytes = Buffer.from(value); },
          async close() { files.set(`${name}/${filename}`, bytes); },
          async abort() {},
        };
      } };
    },
    files,
  };
}

test('folder and ZIP exports use the same classified names and exact bytes, with shipment date on the folder', async () => {
  const exports = require('../sorter-export.js');
  const manifest = exports.createExportManifest(batchFiles(), { pickupDate:'2026-10-30', now:new Date('2026-10-29T17:00:00Z') });
  assert.equal(manifest.folderName, 'FBA_2026-10-30');
  assert.equal(manifest.zipFilename, 'FBA_Sorted_20261030.zip');
  const zipFiles = new Map();
  class Zip {
    file(name, bytes) { zipFiles.set(name, Buffer.from(bytes)); }
    async generateAsync() { return new Blob(['archive']); }
  }
  await exports.createZipBlob(manifest, Zip);
  const parent = fakeDirectory();
  const receipt = await exports.saveOrganizedFolder(manifest, parent);
  assert.deepEqual([...zipFiles.keys()], ['FBA123/BOL-FBA123.pdf', 'FBA123/FBA123-box.pdf', 'FBA123/FBA123.csv', 'FBA456/Pallet-FBA456.pdf']);
  assert.deepEqual(parent.files, zipFiles);
  assert.deepEqual([...parent.entries.keys()], ['FBA_2026-10-30']);
  assert.equal(receipt.fileCount, 4);
  assert.equal(parent.files.get('FBA123/BOL-FBA123.pdf').toString(), 'bill');
});

test('case-equivalent shipment folders are rejected before either output can merge them', () => {
  const exports = require('../sorter-export.js');
  const folders = batchFiles();
  folders.set('fba123', { files:new Map([['extra.pdf', new Blob(['extra'])]]) });
  assert.throws(() => exports.createExportManifest(folders), /資料夾名稱重複/);
});

test('folder date falls back to Taipei today for a missing or invalid shipment date', () => {
  const exports = require('../sorter-export.js');
  for(const pickupDate of ['', '2026-02-31', 'not a date']) {
    assert.equal(exports.createExportManifest(batchFiles(), { pickupDate, now:new Date('2026-10-29T17:00:00Z') }).folderName, 'FBA_2026-10-30');
  }
});

test('an existing output folder is left untouched', async () => {
  const exports = require('../sorter-export.js');
  const manifest = exports.createExportManifest(batchFiles(), { pickupDate:'2026-11-06' });
  const parent = fakeDirectory();
  const existing = await parent.getDirectoryHandle('FBA_2026-11-06', { create:true });
  existing.files.set('original.txt', Buffer.from('keep'));
  await assert.rejects(() => exports.saveOrganizedFolder(manifest, parent), { code:'OUTPUT_FOLDER_EXISTS' });
  assert.deepEqual([...parent.files.keys()], ['original.txt']);
  assert.equal(parent.files.get('original.txt').toString(), 'keep');
});
