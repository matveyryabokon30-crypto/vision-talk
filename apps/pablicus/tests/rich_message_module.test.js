const test = require('node:test');
const assert = require('node:assert/strict');
const rich = require('../src/rich-message.js');

test('mixed message keeps text and media in their original order without carrying arbitrary properties', () => {
  const original = { v: 1, blocks: [
    { id: 't1', type: 'text', text: 'До фото\n<script>hello()</script>', html: '<b>ignored</b>' },
    { id: 'i1', type: 'image', path: 'private/photo.jpg', name: 'Фото.jpg', mime: 'image/jpeg', size: 345, onload: 'ignored' },
    { id: 't2', type: 'text', text: 'После фото' },
    { id: 'v1', type: 'video', assetId: 'local-video', duration: 12.5 },
    { id: 'a1', type: 'audio', assetId: 'local-voice', duration: 3 },
    { id: 'd1', type: 'document', path: 'private/plan.pdf', name: 'План.pdf' }
  ] };
  const result = rich.validate(original);
  assert.equal(result.ok, true);
  assert.deepEqual(result.content.blocks.map(block => block.id), ['t1', 'i1', 't2', 'v1', 'a1', 'd1']);
  assert.equal(result.content.blocks[0].html, undefined);
  assert.equal(result.content.blocks[1].onload, undefined);
  assert.equal(rich.textContent(original), 'До фото\n<script>hello()</script>\nПосле фото');
  assert.equal(original.blocks[0].html, '<b>ignored</b>');
});

test('invalid wire data cannot silently drop or relabel a block', () => {
  for (const blocks of [
    [{ id: 'same', type: 'text', text: 'first' }, { id: 'same', type: 'text', text: 'second' }],
    [{ id: 'one', type: 'unknown', text: 'x' }],
    [{ id: 'one', type: 'image', path: { url: 'bad' } }],
    [{ id: 'one', type: 'video', size: NaN }],
    [{ id: 'one', type: 'audio', duration: -1 }],
    [{ id: 'one', type: 'text', text: { html: '<b>x</b>' } }],
  ]) {
    const result = rich.validate({ v: 1, blocks });
    assert.equal(result.ok, false);
    assert.equal(result.content, null);
    assert.ok(result.errors.length);
  }
  assert.equal(rich.validate({ v: 2, blocks: [] }).ok, false);
});

test('local assets and final server paths both preserve their identifiers', () => {
  const result = rich.validate({ v: 1, blocks: [
    { id: 'local-image', type: 'image', assetId: 'asset-1', name: 'Фото.png' },
    { id: 'server-image', type: 'image', path: 'account/conversation/file.png', width: 2048, height: 1024 }
  ] });
  assert.equal(result.ok, true);
  assert.equal(result.content.blocks[0].assetId, 'asset-1');
  assert.equal(result.content.blocks[1].path, 'account/conversation/file.png');
});

test('adjacent photos and videos form a gallery across empty insertion points', () => {
  const blocks = [
    { id: 't1', type: 'text', text: 'Смотри' },
    { id: 'i1', type: 'image', path: 'photo.jpg' },
    { id: 'empty', type: 'text', text: '  \n' },
    { id: 'v1', type: 'video', path: 'movie.mp4' },
    { id: 't2', type: 'text', text: 'Продолжение' },
    { id: 'i2', type: 'image', path: 'second.jpg' }
  ];
  const layout = rich.groupBlocks(blocks);
  assert.deepEqual(layout.map(item => item.type), ['text', 'gallery', 'text', 'image']);
  assert.deepEqual(layout[1].blocks.map(block => block.id), ['i1', 'v1']);
  assert.equal(blocks.length, 6);
});

test('voice and documents stop visual groups and each retains its reply target', () => {
  const blocks = [
    { id: 'i1', type: 'image' }, { id: 'voice-1', type: 'audio' },
    { id: 'i2', type: 'image' }, { id: 'doc-1', type: 'document' },
    { id: 'v1', type: 'video' }, { id: 'i3', type: 'image' }
  ];
  const layout = rich.groupBlocks(blocks);
  assert.deepEqual(layout.map(item => item.type), ['image', 'audio', 'image', 'document', 'gallery']);
  assert.equal(layout[1].id, 'voice-1');
  assert.equal(layout[3].id, 'doc-1');
});

test('a collapsed large gallery still retains every original attachment in order', () => {
  const blocks = Array.from({ length: 9 }, (_, index) => ({ id: 'image-' + index, type: index % 2 ? 'video' : 'image' }));
  const layout = rich.groupBlocks(blocks);
  assert.equal(layout.length, 1);
  assert.equal(layout[0].type, 'gallery');
  assert.deepEqual(layout[0].blocks.map(block => block.id), blocks.map(block => block.id));
});
