import type { MarketComparableCandidate } from '@ppi/shared';

/** Provider strings remain text, never HTML. Create a fresh node per SDK render. */
export function textPopup(title: string, detail: string) {
  return { title, content: () => {
    const element = document.createElement('div');
    element.textContent = detail;
    return element;
  } };
}

export function marketPopup(item: MarketComparableCandidate) {
  const sale = item.evidenceType === 'RECORDED_SALE';
  const price = item.price === null ? 'Unavailable' : `$${item.price.toLocaleString('en-US')}`;
  return textPopup(sale ? 'Recorded sale' : 'Active listing', [
    item.address, `${sale ? 'Sold Price' : 'Asking Price'}: ${price}`,
    `${sale ? 'Sale date' : 'Listing date'}: ${item.eventDate?.slice(0, 10) ?? 'Unavailable'}`,
    item.distanceMiles === null ? 'Distance unavailable' : `${item.distanceMiles.toFixed(2)} mi away`,
    item.propertyType ?? 'Type unavailable'
  ].join(' · '));
}
