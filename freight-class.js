/* Density-based estimate only; commodity-specific NMFC/FAK rules may override it.
 * Source (checked 2026-09-08):
 * https://nmfta.org/news/decoding-density-the-freight-factor-you-cant-afford-to-overlook/
 * Dimensions include the pallet. Never round density before choosing a bracket.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FBAFreightClass = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({ lengthIn: 48, widthIn: 40, heightIn: 72, palletTareLb: 40 });
  const BRACKETS = Object.freeze([
    [1, 400], [2, 300], [4, 250], [6, 175], [8, 125], [10, 100],
    [12, 92.5], [15, 85], [22.5, 70], [30, 65], [35, 60], [50, 55],
  ].map(Object.freeze));

  /** @param {number} density Unrounded pounds per cubic foot. */
  function classFromDensity(density) {
    if (!Number.isFinite(density) || density <= 0) return null;
    const bracket = BRACKETS.find(([upper]) => density < upper);
    return bracket ? bracket[1] : 50;
  }

  /**
   * One approximate class per shipment, using the EXISTING rounded-up pallet count.
   * Assumes the Amazon content weight excludes pallets; the tare is explicit.
   * This is NOT a SKU packing solver or a declaration of each pallet's class.
   * @param {{cartons:number, weight:number}} shipment Carton count and total lb.
   * @param {number} cartonsPerPallet Existing user-selected pallet capacity.
   * @param {{lengthIn?:number,widthIn?:number,heightIn?:number,palletTareLb?:number}} options
   * @returns {{freightClass:number,pallets:number,grossWeightPerPallet:number}|null}
   */
  function estimateShipmentClass(shipment, cartonsPerPallet, options = {}) {
    if (!shipment || !Number.isSafeInteger(shipment.cartons) || shipment.cartons < 1 ||
        !Number.isFinite(shipment.weight) || shipment.weight <= 0 ||
        !Number.isInteger(cartonsPerPallet) || cartonsPerPallet < 1 || cartonsPerPallet > 999) return null;
    const { lengthIn, widthIn, heightIn, palletTareLb } = { ...DEFAULTS, ...options };
    if (![lengthIn, widthIn, heightIn].every(value => Number.isFinite(value) && value > 0) ||
        !Number.isFinite(palletTareLb) || palletTareLb < 0) return null;
    const pallets = Math.ceil(shipment.cartons / cartonsPerPallet);
    const grossWeightPerPallet = shipment.weight / pallets + palletTareLb;
    const volumeFt3 = lengthIn * widthIn * heightIn / 1728;
    if (!Number.isFinite(volumeFt3) || volumeFt3 <= 0 || !Number.isFinite(grossWeightPerPallet)) return null;
    const freightClass = classFromDensity(grossWeightPerPallet / volumeFt3);
    return freightClass === null ? null : { freightClass, pallets, grossWeightPerPallet };
  }

  return Object.freeze({ DEFAULTS, classFromDensity, estimateShipmentClass });
});
