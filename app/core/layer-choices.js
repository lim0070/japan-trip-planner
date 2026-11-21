import { brands } from "./shopping-catalog.js";

export const choiceLayers = ["food", "shopping"];
const usual = { defaultVisible: true, exceptions: [] };
const cuisineNames = {
  "うどん": "Udon", bread: "Bakeries", curry: "Curry", ice_gelato: "Ice cream & gelato",
  izakaya: "Izakaya", sukiyaki_shabushabu: "Sukiyaki & shabu-shabu", sweets: "Sweets",
  unagi: "Unagi", wagashi: "Wagashi", yakiniku: "Yakiniku", asia_ethnic: "Asian & ethnic",
  shokudo: "Shokudo (casual dining)", spanish: "Spanish", chinese: "Chinese",
  hamburger: "Burgers", tonkatsu: "Tonkatsu", ramen: "Ramen", cafe: "Cafés",
  french: "French", okonomiyaki: "Okonomiyaki", soba: "Soba", steak: "Steak",
  tachinomi: "Tachinomi (standing bars)", toriryori: "Chicken dishes", yakitori: "Yakitori",
  yoshoku: "Yoshoku", creative_innovative: "Creative & innovative", italian: "Italian",
  japanese: "Japanese", pizza: "Pizza",
};

export function layerChoices(saved) {
  return Object.fromEntries(choiceLayers.map(layer => {
    const value = saved?.[layer];
    if (typeof value?.defaultVisible !== "boolean" || !Array.isArray(value.exceptions))
      return [layer, { ...usual }];
    const exceptions = [...new Set(value.exceptions.filter(key =>
      typeof key === "string" && key.length > 0 && key.length <= 200))].slice(0, 512);
    return [layer, { defaultVisible: value.defaultVisible, exceptions }];
  }));
}

export function choiceVisible(selection = usual, key) {
  return selection.exceptions.includes(key) !== selection.defaultVisible;
}

export function chooseOne(selection, key, visible) {
  if (choiceVisible(selection, key) === visible) return selection;
  const exceptions = visible === selection.defaultVisible
    ? selection.exceptions.filter(entry => entry !== key) : [...selection.exceptions, key];
  return { ...selection, exceptions };
}

export function chooseAll(visible) {
  return { defaultVisible: visible, exceptions: [] };
}

export function choiceOptions(feeds, layer) {
  const keys = new Set();
  for (const feed of Object.values(feeds)) {
    if (layer === "food" && feed.source.namespace === "tabelog")
      for (const list of feed.lists) keys.add(list.category);
    if (layer === "shopping" && feed.source.namespace === "shopping")
      for (const place of feed.places) keys.add(place.shopping.brandId);
  }
  return [...keys].map(key => ({ key, label: choiceLabel(layer, key) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en") || a.key.localeCompare(b.key));
}

export function choiceLabel(layer, key) {
  const names = layer === "food" ? cuisineNames : brands;
  return Object.hasOwn(names, key) ? names[key] : key.replaceAll("_", " ");
}
