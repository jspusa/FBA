/* One classified file manifest feeds both ZIP and local folder exports. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FBASorterExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function taipeiDate(now) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function pathSegment(value) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value)) {
      throw new Error('整理後的檔名或資料夾名稱無效，請先檢查詳細檔案。');
    }
    return value;
  }

  function createExportManifest(folders, { pickupDate = '', now = new Date() } = {}) {
    const today = taipeiDate(now);
    const entries = [];
    const names = new Set();
    const folderNames = new Set();
    for (const [folder, meta] of [...folders.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
      const folderName = pathSegment(folder);
      const folderKey = folderName.normalize('NFC').toLowerCase();
      if (folderNames.has(folderKey)) throw new Error(`整理後的資料夾名稱重複：${folderName}`);
      folderNames.add(folderKey);
      for (const [name, file] of [...meta.files.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
        const filename = pathSegment(name);
        const relativePath = `${folderName}/${filename}`;
        const key = relativePath.normalize('NFC').toLowerCase();
        if (names.has(key)) throw new Error(`整理後的檔名重複：${relativePath}`);
        if (typeof file?.arrayBuffer !== 'function') throw new Error(`無法讀取檔案：${relativePath}`);
        names.add(key);
        entries.push(Object.freeze({ folderName, filename, relativePath, file }));
      }
    }
    if (!entries.length) throw new Error('尚未加入任何可匯出的檔案。');
    return Object.freeze({
      folderName:`FBA_${validDate(pickupDate) ? pickupDate : today}`,
      zipFilename:`FBA_Sorted_${today.replaceAll('-', '')}.zip`,
      entries:Object.freeze(entries),
    });
  }

  async function createZipBlob(manifest, Zip) {
    const zip = new Zip();
    for (const entry of manifest.entries) zip.file(entry.relativePath, await entry.file.arrayBuffer());
    return zip.generateAsync({ type:'blob' });
  }

  async function saveOrganizedFolder(manifest, parent) {
    try {
      await parent.getDirectoryHandle(manifest.folderName);
      throw Object.assign(new Error(`目的地已有「${manifest.folderName}」。請選擇其他存放位置，或先移走原資料夾；現有檔案不會被覆寫。`), { code:'OUTPUT_FOLDER_EXISTS' });
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
    }
    const output = await parent.getDirectoryHandle(manifest.folderName, { create:true });
    const directories = new Map();
    let fileCount = 0;
    try {
      for (const entry of manifest.entries) {
        if (!directories.has(entry.folderName)) directories.set(entry.folderName, await output.getDirectoryHandle(entry.folderName, { create:true }));
        const directory = directories.get(entry.folderName);
        const handle = await directory.getFileHandle(entry.filename, { create:true });
        const writable = await handle.createWritable();
        try {
          await writable.write(await entry.file.arrayBuffer());
          await writable.close();
        } catch (error) {
          try { await writable.abort(); } catch (_) {}
          throw error;
        }
        fileCount += 1;
      }
    } catch (error) {
      throw Object.assign(new Error(`「${manifest.folderName}」未完成（已儲存 ${fileCount}/${manifest.entries.length} 個檔案）：${error?.message || '寫入失敗'}。請檢查未完成的資料夾，再選擇其他存放位置重試。`), { code:'FOLDER_WRITE_INCOMPLETE', cause:error });
    }
    return Object.freeze({ folderName:manifest.folderName, fileCount });
  }

  return Object.freeze({ createExportManifest, createZipBlob, saveOrganizedFolder });
});
