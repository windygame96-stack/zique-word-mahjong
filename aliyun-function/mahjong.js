"use strict";

const SUITS = ["m", "p", "s"];
const HONORS = ["z1", "z2", "z3", "z4", "z5", "z6", "z7"];

function tileSortValue(tile) {
  const suit = tile?.slice(0, 1);
  const rank = Number(tile?.slice(1)) || 0;
  const suitIndex = [...SUITS, "z"].indexOf(suit);
  return (suitIndex < 0 ? 9 : suitIndex) * 10 + rank;
}

function sortTiles(tiles) {
  return [...tiles].sort((left, right) => tileSortValue(left) - tileSortValue(right));
}

function tileSuit(tile) {
  return SUITS.includes(tile?.slice(0, 1)) ? tile.slice(0, 1) : "z";
}

function makeMahjongDeck(variant) {
  const tiles = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) tiles.push(`${suit}${rank}`);
    }
  }
  if (variant === "beijing") {
    for (const honor of HONORS) for (let copy = 0; copy < 4; copy += 1) tiles.push(honor);
  }
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [tiles[index], tiles[next]] = [tiles[next], tiles[index]];
  }
  return tiles;
}

function nextHunTile(indicator) {
  const suit = tileSuit(indicator);
  const rank = Number(indicator.slice(1));
  if (suit !== "z") return `${suit}${rank === 9 ? 1 : rank + 1}`;
  if (rank <= 4) return `z${rank === 4 ? 1 : rank + 1}`;
  return `z${rank === 7 ? 5 : rank + 1}`;
}

function removeTiles(hand, wanted) {
  const copy = [...hand];
  for (const tile of wanted) {
    const index = copy.indexOf(tile);
    if (index < 0) return null;
    copy.splice(index, 1);
  }
  return copy;
}

function canFormMelds(counts, wildcards) {
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return wildcards % 3 === 0;

  const sameNeeded = Math.max(0, 3 - counts[first]);
  if (sameNeeded <= wildcards) {
    const next = [...counts];
    next[first] = Math.max(0, next[first] - 3);
    if (canFormMelds(next, wildcards - sameNeeded)) return true;
  }

  const suitIndex = Math.floor(first / 9);
  const rankIndex = first % 9;
  if (suitIndex < 3 && rankIndex <= 6) {
    const next = [...counts];
    let needed = 0;
    for (let offset = 0; offset < 3; offset += 1) {
      const index = first + offset;
      if (next[index] > 0) next[index] -= 1;
      else needed += 1;
    }
    if (needed <= wildcards && canFormMelds(next, wildcards - needed)) return true;
  }
  return false;
}

function tileIndex(tile) {
  const suit = tileSuit(tile);
  const rank = Number(tile.slice(1));
  if (suit === "z") return 27 + rank - 1;
  return SUITS.indexOf(suit) * 9 + rank - 1;
}

function isSevenPairs(tiles, hunTile) {
  if (tiles.length !== 14) return false;
  let wildcards = 0;
  const counts = new Map();
  for (const tile of tiles) {
    if (hunTile && tile === hunTile) wildcards += 1;
    else counts.set(tile, (counts.get(tile) || 0) + 1);
  }
  let singles = 0;
  let pairs = 0;
  for (const count of counts.values()) {
    pairs += Math.floor(count / 2);
    singles += count % 2;
  }
  if (wildcards < singles) return false;
  wildcards -= singles;
  return pairs + singles + Math.floor(wildcards / 2) >= 7;
}

function isWinningHand(tiles, meldCount = 0, hunTile = null) {
  const neededLength = (4 - meldCount) * 3 + 2;
  if (tiles.length !== neededLength) return false;
  if (meldCount === 0 && isSevenPairs(tiles, hunTile)) return true;

  const counts = Array(34).fill(0);
  let wildcards = 0;
  for (const tile of tiles) {
    if (hunTile && tile === hunTile) wildcards += 1;
    else {
      const index = tileIndex(tile);
      if (index < 0 || index >= counts.length) return false;
      counts[index] += 1;
    }
  }

  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] >= 2) {
      const next = [...counts]; next[index] -= 2;
      if (canFormMelds(next, wildcards)) return true;
    }
    if (counts[index] >= 1 && wildcards >= 1) {
      const next = [...counts]; next[index] -= 1;
      if (canFormMelds(next, wildcards - 1)) return true;
    }
  }
  return wildcards >= 2 && canFormMelds(counts, wildcards - 2);
}

function chiOptions(hand, discarded) {
  if (tileSuit(discarded) === "z") return [];
  const suit = tileSuit(discarded);
  const rank = Number(discarded.slice(1));
  const candidates = [[rank - 2, rank - 1], [rank - 1, rank + 1], [rank + 1, rank + 2]];
  return candidates
    .filter((pair) => pair.every((value) => value >= 1 && value <= 9))
    .map((pair) => pair.map((value) => `${suit}${value}`))
    .filter((pair) => removeTiles(hand, pair));
}

function countTile(hand, tile) {
  return hand.filter((item) => item === tile).length;
}

function isSameSuitSelection(hand, indices) {
  if (!Array.isArray(indices) || indices.length !== 3 || new Set(indices).size !== 3) return false;
  const tiles = indices.map((index) => hand[index]);
  return tiles.every(Boolean) && SUITS.includes(tileSuit(tiles[0])) && tiles.every((tile) => tileSuit(tile) === tileSuit(tiles[0]));
}

module.exports = {
  SUITS,
  chiOptions,
  countTile,
  isSameSuitSelection,
  isWinningHand,
  makeMahjongDeck,
  nextHunTile,
  removeTiles,
  sortTiles,
  tileSortValue,
  tileSuit,
};
