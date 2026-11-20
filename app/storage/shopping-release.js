// Previously published, immutable manifests, in release order.
// Each tuple binds the generation, artifact ID, logical feed ID, path, byte count and SHA-256.
// Generations 8–11 and 13–14 use the registry at their original release commit.
const releases = [
  [6, "sha256:2d3dfb2122c4918a17446b79585706e27fa43f687b9c0c943452c002dd96b668", "sha256:23ae433ea0edc63f085e875087294e99058d63718e2bf5fd22b20fb89d6f588c", "shopping-national/2026-11-03-r1/shopping.bundle.v2.json", 17404, "79e572469af762596a5b8ee8935cc5799155bd31878eae7f60b272e0baf5a952"],
  [7, "sha256:44ec04bc7876da78523ae97b819afe28f62985a3aef01bdbe0d8b77b8c477f3e", "sha256:ba736053a75efa3d73a9309e15cd929d0feb2cae3d7c802d2a875cbddd1614bc", "shopping-region/2026-11-03-r1/shopping.bundle.v2.json", 18386, "a1d50c9973a5edc07ac1702a10779d6afbb0a6ea8c809849b054c1195ec6c9e1"],
  [8, "sha256:5a3c51570a02df46e1c907c6f3d9bd47248f07f053a4afd357f7a225923e4fc6", "sha256:2653137f5a6baa5b574e6cac0226e08ebdff369150f6b77bb5c130e7327593f0", "shopping-nonpostal/2026-11-12-r1/shopping.bundle.v2.json", 18776, "fe94a278d8b171bc6c8f364325ba944d6fff46492ce03b8e6fb6ccb33797ce9f"],
  [9, "sha256:169d8ca082ed76020cb48a9e38e9af5c5e6a18e9a12d9bae74f7ed91adde04d3", "sha256:6e0a0a790ebee2c404016e9024d30d718d50c90cbd281e228ac0a9a514b91d6b", "shopping-nonpostal/2026-11-12-r2/shopping.bundle.v2.json", 19176, "258f4ced3b753676f216a5ebbe33a9d5c4b9501b291e1b112dd07b6079d64dc5"],
  [10, "sha256:ce477e097ac00e2a42dc4b56f0ba83d336036f272ec3ccad9f1f0125e48c06f9", "sha256:ee9b15a4ce55380aed3d174a3b0aaf0aadf10f4d1e40ed272991cc2f999626be", "shopping-tenant-hours/2026-11-12-r1/shopping.bundle.v2.json", 19322, "a55f6e7c935933bcfebb4b36068e09bd216cf77f6f9a444816ec86d89c1b91f0"],
  [11, "sha256:fa7dc1f016ce49f9db21baf70b190d1aaed040b6f7f55a730e24ea1684d7ea47", "sha256:8a028669c637c8f1db85a7968277f33e1d676455bff6f35374dd85ad9ff182cc", "shopping-lifecycle/2026-11-12-r1/shopping.bundle.v2.json", 19617, "d460ac8947274ad7f93aa53e07ee66b8c41f70c4e63fa8a41f59e8ea40fb632a"],
  [12, "sha256:b17de9b7c26bb432946cf82b005f53898d40dbbf1ea0dbecd2c6217e99d7e21f", "sha256:19adf964a3b625cba224cc524cf39e41013f3113597657ed21fa9e319018c5ff", "shopping-tenant-hours/2026-11-12-r2/shopping.bundle.v2.json", 19900, "3e68b21d00e9ff37fe8b0394833b863d6f5eccc16a6ac1632705e64b3ab23947"],
  [13, "sha256:4fe98978121367589660822c7b9fe33d1a75769c864f343b480f53251a74b819", "sha256:b0e0e2c2fcdf1f812c254f7bde0d4371c1c732e38cd663a2864e643b9c71b8f8", "shopping-lifecycle/2026-11-12-r2/shopping.bundle.v2.json", 20195, "e783b14a50072bbdd62eb069b452ba3bf7d1ef3ebf848a660214125d9d3472b9"],
  [14, "sha256:a058a3ea4a7ea3830cc846f8b1edec1aa0dd66947808b11e2966f9f58ee87171", "sha256:81159ecca41809b6ee28c98982cfa4f0530f56acc6b26196dcbad4448a54232b", "shopping-lifecycle/2026-11-12-r3/shopping.bundle.v2.json", 20490, "61eb272a7014551473e23b1004f61b8bb1192b730dcb34283f577b868b92049d"],
  [15, "sha256:7d2797c7e06aa428dc09f502a8b91c91fbe5743500dbfc730bf8ae14f86cd332", "sha256:09e056eeb67eae0c3d54d6d47f0dc1c6e099627090a6e266017cd981a629dbc4", "shopping-tenant-hours/2026-11-12-r4/shopping.bundle.v2.json", 20773, "0dad4e61f02df4dfaf935703e7c9fc38db860b630927a6fa61e6c6df265f25b4"],
  [16, "sha256:9fc31f4e88ae4a222e4070fb0dc0aa6a961e52e361d2178780b9a5575344203d", "sha256:8b91eb059f9574df8ca9701b83422cf049b50e2919b7505e274a59e782c8ba81", "shopping-tenant-hours/2026-11-12-r5/shopping.bundle.v2.json", 19695, "6f90553448852bf731aa9b7c951f835e2f884dea74703979183e0423fa07ed9c"],
  [17, "sha256:6f3b30c6ce4ca8bbd2b0e77996aaa68978946fe950d77df8846ade47274babfb", "sha256:cf80f11665715c3c81f4565efa2481ee141f936390f31be17b67741122c23f9f", "shopping-verified/2026-11-12-r1/shopping.bundle.v2.json", 20273, "71358cc76d8758172deeb41c34ffa1bf14548f7a61eb04cea9e927d70cb0b667"],
  [18, "sha256:10ef7eaac9a4417ec186ec7f08801eea329cd7500770ae69512f81fa12debeeb", "sha256:efd77068d20ebcea9f06610efb889b51965d06510843703ae3ab4d6c206631b5", "shopping-lifecycle/2026-11-13-r2/shopping.bundle.v2.json", 20712, "d7d2d59c152b1244e6f72c3606d563a67dc297ebd893cef9cd29325d8e09c674"],
  [19, "sha256:bb986201911af2cec94708ac0d27277fa1096d5392cbec3e7a6632773a1784bf", "sha256:ec1a9193638b99abb0d6e416aca8fc675d00b20d366a6fe0e60d698d9ebea531", "shopping-lifecycle/2026-11-13-r3/shopping.bundle.v2.json", 21007, "bfd8f401ffc81d5aca6e001bb76e3e5a2d27b7979851c616806d7c059f203d8f"],
  [20, "sha256:f09c441d6e3613bd5d57c6c7c744302d22a2753a9ea1224ef09591ec438230a0", "sha256:07e0769066a25312fbc28c6d51e72ddf94eba91e0cf589d7accdb9cb51ba7e06", "shopping-verified/2026-11-13-r5/shopping.bundle.v2.json", 22108, "d5fd1eeb39f0cf82e1bbeafa51aa2ec232a1b9d740b0e0b407c71c481d2fa84e"],
  [21, "sha256:68f1253c15140bfeffd796bd28b607c849b5c9ef1be7401c64e85a2222bfa6c1", "sha256:2921c6298123e64ee458662afecf31eba70b2e61a290ab63503017cce4804e01", "shopping-verified/2026-11-13-r6/shopping.bundle.v2.json", 22418, "c43650dc4fafd2312137e2355193fd5adff5bcff0ecd6b011d7a62cbdd9f3708"],
  [22, "sha256:34cb16a0eee8b0b311897422e626e4e4aa30781457b562452e927df25f1071c0", "sha256:7173a2ca4b2bff820e36c2e8abc03646a53f2ab00c08d0b4352765ace35eee4f", "shopping-verified/2026-11-13-r7/shopping.bundle.v2.json", 22715, "4adb2f4ef302cd2348db433161bdb1642e5f2951dc93b6015d7d92ddc58dcd51"],
  [23, "sha256:924f5d22672f63699da8b930ab0c88d88c831348c65492eb7cf2d344f7868a49", "sha256:b3f4c057018e2e042d4e5094d9d5270e6dddc069f9bfe3a68ded4b3683fe5826", "shopping-verified/2026-11-13-r8/shopping.bundle.v2.json", 23016, "56cb060ead8f7f57bde08c7db6f580e78bb76940a66eb2354bb33d21afdc82fc"],
  [24, "sha256:8db4971a0d604777c901a3a1e6ca1304bdfaa3e7a9ce7a1c063e779c7d7141d2", "sha256:376da3bdd8f0387acc925c8491306b3d93a58beeb993c054be4a7394f29269b7", "shopping-verified/2026-11-19-r1/shopping.bundle.v2.json", 23319, "2631651299a1196d63bb537d6cdc15e5a8e8f336f3c0ba894c776be3d0c84cc9"],
  [25, "sha256:6b4e62e10b2a433af9277e5b3b21642eb0710c06086be78be539ebe33c89f4f7", "sha256:428d7425120672da2a285307c9fd759fe17c6a450716c17d98804cde1ba78bce", "shopping-verified/2026-11-19-r2/shopping.bundle.v2.json", 23616, "a35aea74593fe57a1328e722d553d6a7945c391271cf4cf0f3a37b846e491412"],
  [26, "sha256:f6a0e048edfd57137c626310e809514b5b517dd9f9af5189216b9c13b3ed2e49", "sha256:d4713ccfe30868ec40ce80a683baddbed0d3281b3c07cfb8131d2a1c280c7161", "shopping-verified/2026-11-19-r3/shopping.bundle.v2.json", 23916, "a899c7dbfd2c936f43fdc5359ea5e1e82d1168e235fb6fc46aaa64ca686fa7f1"],
];

export const generation24Release = Object.freeze({
  generation: 24,
  registryPath: "shopping-sources.successor.v11.json",
  registryVersion: "sha256:00c8da0099fa3cf2c1109b4f9c1a4a2de2078b3ceda808a2808ed3bd6c643349",
  artifact: releases.at(-3)[1],
  feedVersion: releases.at(-3)[2],
  osmVersion: "sha256:81443cb00fb61a010100ea309b0df0a9307a6d47a1888fdb6a6eb7ee244f18ff",
});

export const generation25Release = Object.freeze({
  generation: 25,
  registryPath: "shopping-sources.successor.v12.json",
  registryVersion: "sha256:d28b708f8311eeb37c8f689406f2c611ab6975eed75f28c9fa7752f97edfd567",
  artifact: releases.at(-2)[1],
  feedVersion: releases.at(-2)[2],
  osmVersion: "sha256:81443cb00fb61a010100ea309b0df0a9307a6d47a1888fdb6a6eb7ee244f18ff",
});

export const currentShoppingRelease = Object.freeze({
  generation: 26,
  registryPath: "shopping-sources.successor.v13.json",
  registryVersion: "sha256:43fe4d7b79be23ee4a489fa35715ff79c29cdc98b78ecf65e17331e7bc8ffebd",
  artifact: releases.at(-1)[1],
  feedVersion: releases.at(-1)[2],
  osmVersion: "sha256:81443cb00fb61a010100ea309b0df0a9307a6d47a1888fdb6a6eb7ee244f18ff",
});

export function shoppingRelease(version) {
  const artifact = releases.find(row => row[1] === version);
  const matches = artifact ? [artifact] : releases.filter(row => row[2] === version);
  if (matches.length !== 1) return null;
  const [generation, artifactVersion, feedVersion, path, bytes, sha256] = matches[0];
  return { generation, artifact: artifactVersion, feedVersion, path, bytes, sha256 };
}
