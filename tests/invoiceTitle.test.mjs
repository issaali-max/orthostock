// THE WORD "TAX" IN THE INVOICE TITLE — optional, and nothing else may change.
//
// Issa's request, in his words: an option to issue an invoice without the word TAX in
// "TAX INVOICE". Only that word. Everything else must stay exactly as it is.
//
// So this does not merely check that "INVOICE" appears. It renders the SAME invoice both
// ways and asserts the two documents differ in that one word and nowhere else — no
// totals, VAT lines, TRN, customer, table or layout may move.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline'); };
const fs = await import('node:fs');
const { buildInvoiceHtml } = await import('../src/lib/invoicePdf.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const settings = { companyName: 'HO Orthodontics', taxEnabled: false, taxRate: 5, companyPhone: '00971502442398' };
const customer = { id: 'c1', nameEn: 'HARLEY STREET DENTAL CENTER LLC', address: 'abu dhabi MARINA RING ROAD ABU DHABI', trn: '100123' };
const variants = { a: { nameEn: 'Buccal Tube 1st', uom: 'EACH' }, b: { nameEn: 'SS Ligature Tie Short', uom: 'EACH' } };
const items = [
  { invoiceId: 'i', variantId: 'a', qty: 20, unitPrice: 7, total: 140, netTotal: 140, isActive: true },
  { invoiceId: 'i', variantId: 'b', qty: 1, unitPrice: 15, total: 15, netTotal: 15, isActive: true },
];
const base = { id: 'i', invoiceNumber: 'INV-00200', date: '2026-09-12', status: 'active', currency: 'AED',
  total: 155, subtotal: 155, paidAmount: 0, paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [], customerId: 'c1' };
const render = (invoice) => buildInvoiceHtml({ invoice, items, settings, customer, variantById: (id) => variants[id] });

console.log('\n─── 1. The default is unchanged ───');
{
  // An invoice saved before the option existed has no flag, and must look exactly as it
  // always did.
  const legacy = render(base);
  ok('an invoice with no flag still says TAX INVOICE', legacy.includes('TAX INVOICE'));
  const explicit = render({ ...base, showTaxWord: true });
  ok('switching the option on is identical to the default', explicit === legacy);
}

console.log('\n─── 2. Switching it off removes only the word TAX ───');
{
  const withTax = render({ ...base, showTaxWord: true });
  const without = render({ ...base, showTaxWord: false });
  ok('the title reads INVOICE', without.includes('>INVOICE<') || /[>\s]INVOICE[<\s]/.test(without));
  ok('TAX INVOICE no longer appears', !without.includes('TAX INVOICE'));

  // The decisive check: put the word back and the two documents must be IDENTICAL. If
  // anything else had changed — a total, a VAT line, the TRN, a table cell — this fails.
  ok('restoring the word gives back the original byte for byte',
    without.replace('INVOICE', 'TAX INVOICE') === withTax,
    'something other than the word TAX differs between the two documents');
  ok('the documents differ by exactly the four characters "TAX "', withTax.length - without.length === 4,
    `${withTax.length - without.length} characters`);
}

console.log('\n─── 3. Everything else on the page is still there ───');
{
  const without = render({ ...base, showTaxWord: false });
  for (const [what, text] of [
    ['the company', 'HO Orthodontics'],
    ['the customer', 'HARLEY STREET DENTAL CENTER LLC'],
    ['the billing address', 'MARINA RING ROAD'],
    ['the invoice number', 'INV-00200'],
    ['the first material', 'Buccal Tube 1st'],
    ['the second material', 'SS Ligature Tie Short'],
    ['the amount in words', 'One Hundred Fifty Five'],
    ['the balance due', 'Balance Due'],
    ['the customer TRN', '100123'],
  ]) ok(`${what} is unchanged`, without.includes(text), text);
}

console.log('\n─── 4. It is independent of VAT and of the TRN option ───');
{
  // Removing the word is a presentation choice. It must not switch VAT off, hide the VAT
  // column, or interact with the TRN checkbox.
  const taxed = { ...settings, taxEnabled: true };
  const renderT = (invoice) => buildInvoiceHtml({ invoice, items, settings: taxed, customer, variantById: (id) => variants[id] });
  const a = renderT({ ...base, taxApplied: true, showTaxWord: true });
  const b = renderT({ ...base, taxApplied: true, showTaxWord: false });
  ok('with VAT applied, only the word still differs', b.replace('INVOICE', 'TAX INVOICE') === a);

  const noTrn = render({ ...base, showTrn: false, showTaxWord: false });
  ok('hiding TRN and the word together still hides TRN', !noTrn.includes('100123'));
  ok('and still drops the word', !noTrn.includes('TAX INVOICE'));
}

console.log('\n─── 5. The option is saved with the invoice ───');
{
  // Stored on the invoice like showTrn, so printing the same invoice next month gives the
  // same title rather than whatever the checkbox happens to say then.
  const ui = fs.readFileSync(new URL('../src/features/sales/InvoiceCreate.jsx', import.meta.url), 'utf8');
  ok('it is part of the saved invoice', /taxApplied, showTrn, showTaxWord,/.test(ui));
  ok('an edited invoice keeps its own choice', /editing\?\.showTaxWord != null \? !!editing\.showTaxWord : true/.test(ui));
  ok('it defaults to showing the word', /useState\(editing\?\.showTaxWord != null \? !!editing\.showTaxWord : true\)/.test(ui));
  const i18n = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');
  ok('the label exists in both languages', (i18n.match(/showTaxWord:/g) || []).length === 2);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'INVOICE TITLE: PROBLEMS FOUND' : 'INVOICE TITLE: CLEAN');
process.exit(fail ? 1 : 0);
