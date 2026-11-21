const foodSymbols = {
  "asia_ethnic": "food-asia-ethnic",
  "bread": "food-bread",
  "cafe": "food-cafe",
  "chinese": "food-chinese",
  "creative_innovative": "food-creative-innovative",
  "curry": "food-curry",
  "french": "food-french",
  "hamburger": "food-hamburger",
  "ice_gelato": "food-ice-gelato",
  "italian": "food-italian",
  "izakaya": "food-izakaya",
  "japanese": "food-japanese",
  "okonomiyaki": "food-okonomiyaki",
  "pizza": "food-pizza",
  "ramen": "food-ramen",
  "shokudo": "food-shokudo",
  "soba": "food-soba",
  "spanish": "food-spanish",
  "steak": "food-steak",
  "sukiyaki_shabushabu": "food-sukiyaki-shabushabu",
  "sweets": "food-sweets",
  "tachinomi": "food-tachinomi",
  "tonkatsu": "food-tonkatsu",
  "toriryori": "food-toriryori",
  "unagi": "food-unagi",
  "wagashi": "food-wagashi",
  "yakiniku": "food-yakiniku",
  "yakitori": "food-yakitori",
  "yoshoku": "food-yoshoku",
  "うどん": "food-udon"
};

export function foodSymbolId(category) {
  return Object.hasOwn(foodSymbols, category) ? foodSymbols[category] : "food-other";
}

export const shopIcons = {
  "avail": {
    "file": "assets/avail.svg",
    "kind": "planner-symbol"
  },
  "birthday": {
    "file": "assets/birthday.svg",
    "kind": "planner-symbol"
  },
  "chambre": {
    "file": "assets/chambre.svg",
    "kind": "planner-symbol"
  },
  "costco": {
    "file": "assets/costco.png",
    "kind": "brand-mark",
    "wide": true
  },
  "divalo": {
    "file": "assets/divalo.svg",
    "kind": "planner-symbol"
  },
  "global-work": {
    "file": "assets/global-work.svg",
    "kind": "planner-symbol"
  },
  "gu": {
    "file": "assets/gu.png",
    "kind": "brand-mark"
  },
  "hands": {
    "file": "assets/hands.png",
    "kind": "brand-mark"
  },
  "life-supermarket": {
    "file": "assets/life-supermarket.png",
    "kind": "brand-mark"
  },
  "lopia": {
    "file": "assets/lopia.png",
    "kind": "brand-mark"
  },
  "nitori": {
    "file": "assets/nitori.png",
    "kind": "brand-mark"
  },
  "outlet-mall": {
    "file": "assets/outlet-mall.svg",
    "kind": "planner-symbol"
  },
  "shimamura": {
    "file": "assets/shimamura.png",
    "kind": "brand-mark",
    "wide": true
  },
  "uniqlo": {
    "file": "assets/uniqlo.png",
    "kind": "brand-mark"
  },
  "workman": {
    "file": "assets/workman.png",
    "kind": "brand-mark",
    "wide": true
  }
};

// Compact map-only faces. Full marks above remain available in the lists and details.
export const roundShopIcons = {
  "avail": {
    "file": "round/avail.svg",
    "kind": "planner-symbol"
  },
  "birthday": {
    "file": "round/birthday.svg",
    "kind": "planner-symbol"
  },
  "chambre": {
    "file": "round/chambre.svg",
    "kind": "planner-symbol"
  },
  "costco": {
    "file": "round/costco.png",
    "kind": "compact-interpretation"
  },
  "divalo": {
    "file": "round/divalo.svg",
    "kind": "planner-symbol"
  },
  "global-work": {
    "file": "round/global-work.svg",
    "kind": "planner-symbol"
  },
  "gu": {
    "file": "round/gu.png",
    "kind": "compact-adaptation"
  },
  "hands": {
    "file": "round/hands.png",
    "kind": "compact-adaptation"
  },
  "life-supermarket": {
    "file": "round/life-supermarket.png",
    "kind": "compact-adaptation"
  },
  "lopia": {
    "file": "round/lopia.png",
    "kind": "compact-adaptation"
  },
  "nitori": {
    "file": "round/nitori.png",
    "kind": "compact-adaptation"
  },
  "outlet-mall": {
    "file": "round/outlet-mall.svg",
    "kind": "planner-symbol"
  },
  "shimamura": {
    "file": "round/shimamura.png",
    "kind": "compact-interpretation"
  },
  "uniqlo": {
    "file": "round/uniqlo.png",
    "kind": "compact-adaptation"
  },
  "workman": {
    "file": "round/workman.png",
    "kind": "compact-interpretation"
  }
};
