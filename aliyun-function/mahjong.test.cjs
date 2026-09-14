"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { chiOptions, isWinningHand, makeMahjongDeck, nextHunTile } = require("./mahjong");

test("川麻与京麻使用正确牌数", () => {
  assert.equal(makeMahjongDeck("sichuan").length, 108);
  assert.equal(makeMahjongDeck("beijing").length, 136);
});

test("判定普通胡、七对与混儿胡", () => {
  assert.equal(isWinningHand(["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s7", "s7", "z5", "z5"]), true);
  assert.equal(isWinningHand(["m1", "m1", "m2", "m2", "p3", "p3", "p4", "p4", "s5", "s5", "s6", "s6", "z1", "z1"]), true);
  assert.equal(isWinningHand(["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s7", "s7", "z5", "z6"], 0, "z6"), true);
  assert.equal(isWinningHand(["m1", "m2", "m4", "m5", "m7", "p2", "p4", "p6", "s1", "s4", "s7", "z1", "z3", "z5"]), false);
});

test("京麻混儿上滚与吃牌组合", () => {
  assert.equal(nextHunTile("m9"), "m1");
  assert.equal(nextHunTile("z4"), "z1");
  assert.equal(nextHunTile("z7"), "z5");
  assert.deepEqual(chiOptions(["m1", "m2", "m4", "m5", "m6"], "m3"), [["m1", "m2"], ["m2", "m4"], ["m4", "m5"]]);
  assert.deepEqual(chiOptions(["z1", "z2"], "z3"), []);
});
