export const brands = {
  "outlet-mall": "Outlet malls",
  gu: "GU",
  uniqlo: "UNIQLO",
  "global-work": "GLOBAL WORK",
  workman: "WORKMAN",
  shimamura: "Shimamura",
  avail: "Avail",
  birthday: "Birthday",
  chambre: "Chambre",
  divalo: "Divalo",
  costco: "Costco",
  lopia: "Lopia",
  "life-supermarket": "Life Supermarket",
  nitori: "Nitori",
  hands: "Hands / Tokyu Hands",
};
export const formats = {
  standard: "Standard",
  warehouse: "Warehouse",
  supermarket: "Supermarket",
  "nitori-express": "Nitori EXPRESS",
  workman: "WORKMAN",
  "workman-plus": "WORKMAN Plus",
  "workman-colors": "WORKMAN Colors",
  "workman-girl": "WORKMAN Girl",
  "workman-pro": "WORKMAN Pro",
};
export const shoppingCategories = {
  "outlet-malls": "Outlet malls",
  clothing: "Clothing & fashion",
  "warehouse-clubs": "Warehouse clubs",
  supermarkets: "Supermarkets",
  "furniture-home": "Furniture & home",
  "lifestyle-diy": "Lifestyle, stationery & DIY",
  "other-shopping": "Other shopping",
};
export function categoryFor(brand) {
  if (brand === "outlet-mall") return "outlet-malls";
  const mapped = {
    costco: "warehouse-clubs",
    lopia: "supermarkets",
    "life-supermarket": "supermarkets",
    nitori: "furniture-home",
    hands: "lifestyle-diy",
  };
  return (
    (Object.hasOwn(mapped, brand) ? mapped[brand] : null) ||
    (Object.hasOwn(brands, brand) ? "clothing" : "other-shopping")
  );
}
