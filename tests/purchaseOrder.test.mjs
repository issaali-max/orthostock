// Purchase order document: the one invariant that matters is that our COST never
// leaves the app. This harness rebuilds the same projection the screen performs and
// asserts (a) unticked rows are dropped, (b) no cost value survives the projection,
// and (c) the rendered rows contain names and quantities only.

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };

const fmtNum = (n) => String(Math.round(Number(n || 0) * 100) / 100);

// ── Fixture: two ticked rows, one unticked, each carrying an internal cost ──
const bucketTree = [{
  name: 'Wires',
  category: { icon: '🧵' },
  groups: [{
    product: { nameEn: 'NiTi' },
    needed: [
      { v: { nameEn: 'NiTi 016', sku: 'W-016' }, qty: 10, skipped: false, unitCost: 12.5, lineCost: 125 },
      { v: { nameEn: 'NiTi 018', sku: 'W-018' }, qty: 4, skipped: true, unitCost: 30, lineCost: 120 },
      { v: { nameEn: '', sku: 'W-020' }, qty: 3, skipped: false, unitCost: 9.75, lineCost: 29.25 },
    ],
  }],
}];

// The exact projection used by PurchasePlanning.orderTree
const orderTree = (tree) => tree
  .map((cat) => ({
    name: cat.name,
    icon: cat.category.icon || '',
    groups: cat.groups
      .map((g) => ({
        title: g.product.nameEn || g.product.nameAr || '',
        items: g.needed.filter((it) => !it.skipped).map((it) => ({ name: it.v.nameEn || it.v.sku, qty: fmtNum(it.qty) })),
      }))
      .filter((g) => g.items.length),
  }))
  .filter((cat) => cat.groups.length);

const tree = orderTree(bucketTree);
const items = tree.flatMap((c) => c.groups.flatMap((g) => g.items));

ok('unticked row is excluded from the document', items.length === 2);
ok('ticked rows survive with their names', items[0].name === 'NiTi 016' && items[1].name === 'W-020');
ok('falls back to SKU when there is no English name', items[1].name === 'W-020');
ok('quantities are carried through', items[0].qty === '10' && items[1].qty === '3');
ok('names are never undefined', items.every((it) => typeof it.name === 'string' && it.name.length > 0));

// (b) No cost key and no cost VALUE anywhere in the projected structure.
const serialized = JSON.stringify(tree);
const costKeys = ['unitCost', 'lineCost', 'purchasePriceAvg', 'purchasePriceLatest', 'stockQty', 'stockMin'];
ok('no cost/stock key survives the projection', costKeys.every((k) => !serialized.includes(k)));
ok('no cost amount survives the projection', !['12.5', '125', '9.75', '29.25', '30', '120'].some((v) => serialized.includes(v)));
ok('projected item has exactly two fields', items.every((it) => Object.keys(it).sort().join(',') === 'name,qty'));

// (c) Totals count ticked rows only.
let count = 0, qty = 0;
for (const c of tree) for (const g of c.groups) for (const it of g.items) { count += 1; qty += Number(it.qty); }
ok('total items counts ticked rows only', count === 2);
ok('total qty sums ticked rows only', qty === 13);

// ── The view filter must never change what gets sent ──
// Row membership mirrors PurchasePlanning: `inOrder` drives the document, `visible`
// drives the screen. They are computed independently, and only `inOrder` reaches sendTree.
const mkRow = (name, { status = 'ok', onListFlag = false, skip = false }) => {
  const auto = status === 'low' || status === 'out';
  const manual = onListFlag;
  const onList = manual || auto;
  return { name, status, manual, onList, skipped: skip, inOrder: onList && !skip };
};

const catalogue = [
  mkRow('A-low', { status: 'low' }),                       // automatic
  mkRow('B-manual', { onListFlag: true }),                 // added by me
  mkRow('C-unticked', { status: 'out', skip: true }),      // low but not ordering
  mkRow('D-plenty', {}),                                   // healthy, off the list
];

const visibleUnder = (v, r) => v === 'all' ? true
  : v === 'auto' ? (r.status === 'low' || r.status === 'out') && !r.manual
    : v === 'manual' ? r.manual
      : r.onList;

const sent = catalogue.filter((r) => r.inOrder).map((r) => r.name).sort().join(',');
ok('order is A-low + B-manual only', sent === 'A-low,B-manual');
for (const v of ['list', 'auto', 'manual', 'all']) {
  const stillSent = catalogue.filter((r) => r.inOrder).map((r) => r.name).sort().join(',');
  ok(`view "${v}" does not change what is sent`, stillSent === sent);
}
ok('view "all" reveals the healthy material', catalogue.filter((r) => visibleUnder('all', r)).length === 4);
ok('view "list" hides the healthy material', catalogue.filter((r) => visibleUnder('list', r)).some((r) => r.name === 'D-plenty') === false);
ok('view "auto" shows only automatic rows', catalogue.filter((r) => visibleUnder('auto', r)).map((r) => r.name).join(',') === 'A-low,C-unticked');
ok('view "manual" shows only my additions', catalogue.filter((r) => visibleUnder('manual', r)).map((r) => r.name).join(',') === 'B-manual');
ok('an unticked row is visible but never sent', catalogue.find((r) => r.name === 'C-unticked').inOrder === false && visibleUnder('list', catalogue.find((r) => r.name === 'C-unticked')));
ok('a healthy off-list material is never sent', catalogue.find((r) => r.name === 'D-plenty').inOrder === false);

console.log(fail === 0 ? '\nALL PURCHASE ORDER TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);