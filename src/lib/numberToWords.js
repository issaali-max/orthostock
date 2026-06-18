// numberToWords.js — amount in words for invoices (English, UAE Dirham/Fils).
// e.g. amountToWords(714) -> "Seven Hundred Fourteen UAE Dirham Only"
//      amountToWords(178.5) -> "One Hundred Seventy Eight UAE Dirham and Fifty Fils Only"

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigitsToWords(n) {
  let out = '';
  if (n >= 100) { out += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) out += ' '; }
  if (n >= 20) { out += TENS[Math.floor(n / 10)]; n %= 10; if (n) out += ' '; }
  if (n > 0 && n < 20) out += ONES[n];
  return out;
}

function intToWords(n) {
  if (n === 0) return 'Zero';
  const scales = ['', ' Thousand', ' Million', ' Billion'];
  let out = '';
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) out = threeDigitsToWords(chunk) + scales[scale] + (out ? ' ' + out : '');
    n = Math.floor(n / 1000);
    scale++;
  }
  return out.trim();
}

export function amountToWords(amount, currency = 'AED') {
  const safe = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  const dirhams = Math.floor(safe);
  const fils = Math.round((safe - dirhams) * 100);
  const unit = currency === 'USD' ? 'US Dollar' : 'UAE Dirham';
  const cents = currency === 'USD' ? 'Cents' : 'Fils';
  let words = `${intToWords(dirhams)} ${unit}`;
  if (fils > 0) words += ` and ${intToWords(fils)} ${cents}`;
  return words + ' Only';
}
