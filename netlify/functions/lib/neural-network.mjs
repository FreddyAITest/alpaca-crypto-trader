// Neural Network for Trade Signal Prediction - DEF-13
// Pure JS feedforward MLP — no dependencies. Fits in Netlify serverless (~1-2s/training).
//
// Architecture:
//   Input:  14 features (RSI, MACD, volume, ATR, ADX, BB, price/EMA, daily chg, regime×5, strategy)
//   Hidden: 8 neurons, ReLU
//   Output: 1 neuron, linear (predicted PnL%)
//
// Weights stored in Netlify Blobs keyed "nn-weights" in the bot-state store.

import { getStore } from "@netlify/blobs";

const STORE_NAME = "bot-state";
const WEIGHTS_KEY = "nn-weights";

const INPUT_SIZE = 14;
const HIDDEN_SIZE = 8;
const OUTPUT_SIZE = 1;

// ============================================================
// FEATURE EXTRACTION
// ============================================================

/**
 * Extract normalized feature vector from a signal + bar data + market regime.
 * All values normalized to [0, 1].
 *
 * @param {Object} signal - Signal from scanSymbols (has .indicators, .strategy)
 * @param {Array} bars - OHLCV bar data for this symbol
 * @param {string} regime - Current market regime string
 * @returns {number[]} 14-element feature array
 */
export function extractFeatures(signal, bars, regime) {
  const closes = bars ? bars.map(b => b.c || b.close || 0) : [];
  const volumes = bars ? bars.map(b => b.v || b.volume || 0) : [];
  const lastIdx = closes.length - 1;

  // 0: RSI — from signal indicators or compute
  const rsi = signal.indicators?.rsi;
  const f0 = rsi !== undefined ? clamp(rsi / 100, 0, 1) : 0.5;

  // 1: MACD histogram — compute from closes
  let f1 = 0.5;
  if (closes.length >= 26) {
    const macdData = computeMacd(closes);
    const hist = macdData.histogram;
    if (hist.length > 0) {
      const lastHist = hist[hist.length - 1];
      const price = closes[lastIdx] || 1;
      f1 = clamp((Math.tanh(lastHist / price * 100) + 1) / 2, 0, 1);
    }
  }

  // 2: Volume ratio — current vol / avg vol
  let f2 = 0.5;
  if (volumes.length >= 20) {
    const avg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const curVol = volumes[lastIdx] || 0;
    f2 = avg20 > 0 ? clamp(curVol / avg20 / 3, 0, 1) : 0.5;
  }

  // 3: ATR% at entry
  const atrPct = signal.indicators?.atrPct;
  const f3 = atrPct !== undefined ? clamp(atrPct / 10, 0, 1) : 0.2;

  // 4: ADX — from bars
  let f4 = 0.25;
  if (bars && bars.length >= 28) {
    const adxVal = computeAdx(bars);
    f4 = clamp(adxVal / 100, 0, 1);
  }

  // 5: BB %B position
  const bbPB = signal.indicators?.bbPercentB;
  const f5 = bbPB !== undefined ? clamp(bbPB, 0, 1) : 0.5;

  // 6: Price vs EMA21
  let f6 = 0.5;
  if (closes.length >= 21) {
    const ema21 = calcEma(closes, 21);
    const lastEma = ema21[ema21.length - 1];
    if (lastEma > 0) {
      const ratio = (closes[lastIdx] - lastEma) / lastEma;
      f6 = clamp((Math.tanh(ratio * 20) + 1) / 2, 0, 1);
    }
  }

  // 7: Daily change %
  let f7 = 0.5;
  if (bars && bars.length >= 2) {
    const open0 = bars[0].o || bars[0].open;
    const close1 = closes[lastIdx];
    if (open0 > 0) {
      const dailyChg = (close1 - open0) / open0;
      f7 = clamp(dailyChg / 0.1 * 0.5 + 0.5, 0, 1);
    }
  }

  // 8-12: Regime one-hot (5 regimes)
  const regimeList = ["trending_up", "trending_down", "ranging", "volatile", "transitional"];
  const f8to12 = regimeList.map(r => regime === r ? 1.0 : 0.0);

  // 13: Strategy encoding
  const strategyMap = { momentum: 0, scalp: 0.25, "mean-reversion": 0.5, "stock-momentum": 0.75 };
  const f13 = strategyMap[signal.strategy] !== undefined ? strategyMap[signal.strategy] : 0.5;

  return [f0, f1, f2, f3, f4, f5, f6, f7, ...f8to12, f13];
}

// ============================================================
// NEURAL NETWORK CORE
// ============================================================

function createWeights() {
  return {
    W1: randomMatrix(INPUT_SIZE, HIDDEN_SIZE),
    b1: new Array(HIDDEN_SIZE).fill(0),
    W2: randomMatrix(HIDDEN_SIZE, OUTPUT_SIZE),
    b2: new Array(OUTPUT_SIZE).fill(0),
  };
}

function randomMatrix(rows, cols) {
  // He initialization for ReLU
  const std = Math.sqrt(2 / rows);
  const m = [];
  for (let i = 0; i < rows; i++) {
    m[i] = [];
    for (let j = 0; j < cols; j++) {
      m[i][j] = gaussianRandom() * std;
    }
  }
  return m;
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Forward pass: returns { hidden, hiddenAct, output, outputAct } for backprop
function forward(features, weights) {
  const { W1, b1, W2, b2 } = weights;

  // Input → Hidden
  const hidden = new Array(HIDDEN_SIZE);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let sum = b1[j];
    for (let i = 0; i < INPUT_SIZE; i++) {
      sum += features[i] * W1[i][j];
    }
    hidden[j] = sum;
  }

  // ReLU activation
  const hiddenAct = hidden.map(v => Math.max(0, v));

  // Hidden → Output
  let output = b2[0];
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    output += hiddenAct[j] * W2[j][0];
  }

  return { hidden, hiddenAct, output };
}

// Predict only (forward pass, returns scalar)
export function predict(features, weights) {
  if (!weights) return 0;
  const { output } = forward(features, weights);
  return output;
}

// MSE loss
function mseLoss(predictions, labels) {
  let loss = 0;
  for (let i = 0; i < predictions.length; i++) {
    const diff = predictions[i] - labels[i];
    loss += diff * diff;
  }
  return loss / predictions.length;
}

function maeLoss(predictions, labels) {
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    sum += Math.abs(predictions[i] - labels[i]);
  }
  return sum / predictions.length;
}

// Train one epoch with mini-batch SGD
function trainEpoch(batch, weights, lr) {
  let totalLoss = 0;

  for (const sample of batch) {
    const { features, label } = sample;
    const { hidden, hiddenAct, output } = forward(features, weights);

    const error = output - label;
    totalLoss += error * error;

    // Backprop: output → hidden gradient
    // dL/dW2 = hiddenAct * error
    // dL/db2 = error
    const dW2 = new Array(HIDDEN_SIZE);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      dW2[j] = hiddenAct[j] * error;
    }
    const db2 = error;

    // Gradient for hidden activations
    const dHiddenAct = new Array(HIDDEN_SIZE);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      dHiddenAct[j] = error * weights.W2[j][0];
    }

    // ReLU gradient
    const dHidden = new Array(HIDDEN_SIZE);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      dHidden[j] = hidden[j] > 0 ? dHiddenAct[j] : 0;
    }

    // Gradient for W1, b1
    const dW1 = [];
    for (let i = 0; i < INPUT_SIZE; i++) {
      dW1[i] = new Array(HIDDEN_SIZE);
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        dW1[i][j] = features[i] * dHidden[j];
      }
    }
    const db1 = dHidden;

    // Update weights (SGD)
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      weights.W2[j][0] -= lr * dW2[j];
      weights.b1[j] -= lr * db1[j];
    }
    weights.b2[0] -= lr * db2;

    for (let i = 0; i < INPUT_SIZE; i++) {
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        weights.W1[i][j] -= lr * dW1[i][j];
      }
    }
  }

  return totalLoss / batch.length;
}

// ============================================================
// TRAINING ORCHESTRATION
// ============================================================

/**
 * Train the neural network on the trade buffer.
 * Handles train/test split, training loop, and metrics.
 *
 * @param {Array} tradeBuffer - Array of {features, label} from trade outcomes
 * @param {Object} existingWeights - Optional existing weights to continue training
 * @returns {{ weights: Object, metrics: Object }}
 */
export function trainNeuralNetwork(tradeBuffer, existingWeights) {
  if (!tradeBuffer || tradeBuffer.length < 20) {
    return { weights: existingWeights || null, metrics: { trainLoss: null, testLoss: null, testMae: null, bufferSize: tradeBuffer?.length || 0, trained: false } };
  }

  // Shuffle buffer (Fisher-Yates)
  const shuffled = [...tradeBuffer];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 80/20 split
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainSet = shuffled.slice(0, Math.max(splitIdx, 2));
  const testSet = shuffled.slice(splitIdx);
  if (testSet.length < 2) {
    // Rebalance: at least 2 in test set
    const minTest = Math.min(2, Math.floor(shuffled.length * 0.3));
    const newSplit = Math.max(2, shuffled.length - minTest);
    const trainSubset = shuffled.slice(0, newSplit);
    const testSubset = shuffled.slice(newSplit);
    return wrapResult(trainSubset, testSubset, existingWeights);
  }

  return wrapResult(trainSet, testSet, existingWeights);
}

function wrapResult(trainSet, testSet, existingWeights) {
  const weights = existingWeights ? deepCopyWeights(existingWeights) : createWeights();
  const lr = 0.01;
  const epochs = 40;
  const batchSize = 8;

  let trainLoss = 0;
  let testLoss = null;
  let testMae = null;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Mini-batch SGD
    let epochLoss = 0;
    for (let b = 0; b < trainSet.length; b += batchSize) {
      const batch = trainSet.slice(b, b + batchSize);
      epochLoss += trainEpoch(batch, weights, lr);
    }
    trainLoss = epochLoss / Math.ceil(trainSet.length / batchSize);
  }

  // Evaluate on test set
  const testPreds = testSet.map(s => predict(s.features, weights));
  const testLabels = testSet.map(s => s.label);
  testLoss = mseLoss(testPreds, testLabels);
  testMae = maeLoss(testPreds, testLabels);

  console.log(`NN: trained on ${trainSet.length} samples, test=${testSet.length}, trainLoss=${trainLoss.toFixed(6)}, testLoss=${testLoss.toFixed(6)}, testMAE=${testMae.toFixed(6)}`);

  return {
    weights,
    metrics: {
      trainLoss,
      testLoss,
      testMae,
      bufferSize: trainSet.length + testSet.length,
      trainSize: trainSet.length,
      testSize: testSet.length,
      trainedAt: new Date().toISOString(),
      trained: true,
    },
  };
}

function deepCopyWeights(w) {
  return {
    W1: w.W1.map(row => [...row]),
    b1: [...w.b1],
    W2: w.W2.map(row => [...row]),
    b2: [...w.b2],
  };
}

// ============================================================
// WEIGHT PERSISTENCE (Netlify Blobs)
// ============================================================

/**
 * Load NN weights from Netlify Blobs.
 */
export async function loadNNWeights() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(WEIGHTS_KEY, { type: "json" });
    if (raw && raw.W1 && raw.W2) return raw;
    return null;
  } catch (e) {
    console.log(`NN: could not load weights - ${e.message}`);
    return null;
  }
}

/**
 * Save NN weights to Netlify Blobs.
 */
export async function saveNNWeights(weights) {
  if (!weights) return false;
  try {
    const store = getStore(STORE_NAME);
    await store.setJSON(WEIGHTS_KEY, weights);
    return true;
  } catch (e) {
    console.log(`NN: could not save weights - ${e.message}`);
    return false;
  }
}

// ============================================================
// INDICATOR HELPERS (self-contained, no deps)
// ============================================================

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function calcEma(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function computeMacd(closes) {
  const ema12 = calcEma(closes, 12);
  const ema26 = calcEma(closes, 26);
  const macdLine = [];
  const startIdx = 25;
  for (let i = startIdx; i < closes.length; i++) {
    if (ema12[i] !== undefined && ema26[i] !== undefined) {
      macdLine.push(ema12[i] - ema26[i]);
    }
  }
  const signalLine = calcEma(macdLine, 9);
  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    histogram.push(signalLine[i] !== undefined ? macdLine[i] - signalLine[i] : 0);
  }
  return { macdLine, signalLine, histogram };
}

function computeAdx(bars) {
  const highs = bars.map(b => b.h || b.high);
  const lows = bars.map(b => b.l || b.low);
  const closes = bars.map(b => b.c || b.close);
  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < bars.length; i++) {
    const h = highs[i] - highs[i - 1];
    const l = lows[i - 1] - lows[i];
    const atrVal = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    tr.push(atrVal);
    plusDM.push(h > l && h > 0 ? h : 0);
    minusDM.push(l > h && l > 0 ? l : 0);
  }
  const period = 14;
  if (tr.length < period) return 0;
  let sumTR = 0, sumPlus = 0, sumMinus = 0;
  for (let i = 0; i < period; i++) { sumTR += tr[i]; sumPlus += plusDM[i]; sumMinus += minusDM[i]; }
  let atrS = sumTR, plusS = sumPlus, minusS = sumMinus;
  const adxVals = [];
  for (let i = period; i < tr.length; i++) {
    atrS = atrS - atrS / period + tr[i];
    plusS = plusS - plusS / period + plusDM[i];
    minusS = minusS - minusS / period + minusDM[i];
    const pDI = 100 * plusS / atrS;
    const mDI = 100 * minusS / atrS;
    const dx = (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 || 0;
    adxVals.push(dx);
  }
  const adxEma = calcEma(adxVals, period);
  return adxEma.length > 0 ? adxEma[adxEma.length - 1] : 0;
}
