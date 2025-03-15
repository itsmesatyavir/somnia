import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = process.env.RPC_URL || "https://dream-rpc.somnia.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PING_TOKEN_ADDRESS = process.env.PING_TOKEN_ADDRESS || "";
const PONG_TOKEN_ADDRESS = process.env.PONG_TOKEN_ADDRESS || "";
const NETWORK_NAME = process.env.NETWORK_NAME || "Somnia Testnet";
const swapContractAddress = "0x6AAC14f090A35EeA150705f72D90E4CDC4a49b2C";
const swapContractABI = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint24", "name": "fee", "type": "uint24" },
          { "internalType": "address", "name": "recipient", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
          { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "internalType": "struct ExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [
      { "internalType": "uint256", "name": "amountOut", "type": "uint256" }
    ],
    "stateMutability": "payable",
    "type": "function"
  }
];

const PING_ABI = [
  "function mint() public payable",
  "function balanceOf(address owner) view returns (uint256)",
  "function isMinter(address account) view returns (bool)"
];

const PONG_ABI = [
  "function mint() public payable",
  "function balanceOf(address owner) view returns (uint256)",
  "function isMinter(address account) view returns (bool)"
];

let walletInfo = {
  address: "",
  balanceNative: "0.00",
  balancePing: "0.00",
  balancePong: "0.00",
  network: NETWORK_NAME,
};
let transactionLogs = [];
let autoSwapRunning = false;
let autoSwapCancelled = false;
let claimFaucetRunning = false;
let claimFaucetCancelled = false;
let autoSendRunning = false;
let autoSendCancelled = false;
let globalWallet = null;

function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}
function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}
let renderTimeout;
function safeRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    screen.render();
  }, 50);
}
function updateLogs() {
  logsBox.setContent(transactionLogs.join("\n"));
  logsBox.setScrollPerc(100);
  safeRender();
}
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  transactionLogs.push(`${timestamp}  ${message}`);
  updateLogs();
}
function clearTransactionLogs() {
  transactionLogs = [];
  updateLogs();
  addLog("Transaction logs have been cleared.");
}
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function delay(ms) {
  return Promise.race([
    new Promise(resolve => setTimeout(resolve, ms)),
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (autoSwapCancelled || autoSendCancelled) {
          clearInterval(interval);
          resolve();
        }
      }, 1);
    })
  ]);
}

function getTokenName(address) {
  if (address.toLowerCase() === PING_TOKEN_ADDRESS.toLowerCase()) {
    return "Ping";
  } else if (address.toLowerCase() === PONG_TOKEN_ADDRESS.toLowerCase()) {
    return "Pong";
  } else {
    return address;
  }
}

async function claimFaucetPing() {
    if (claimFaucetRunning) {
      addLog("Claim Faucet Ping is already running.");
      return;
    }
    claimFaucetRunning = true;
    updateFaucetSubMenuItems();
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      let pk = PRIVATE_KEY.trim();
      if (!pk.startsWith("0x")) pk = "0x" + pk;
      const wallet = new ethers.Wallet(pk, provider);
      const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, PING_ABI, wallet);
      const alreadyMinted = await pingContract.isMinter(wallet.address);
      if (alreadyMinted) {
        addLog("PING Faucet has already been claimed.");
        return;
      }
      addLog("Claiming Faucet Ping...");
      const tx = await pingContract.mint({ value: 0 });
      addLog(`Transaction sent. Tx Hash: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog("Claim Faucet Ping successful!");
      await delay(5000);
      updateWalletData();
    } catch (error) {
      addLog("Claim Faucet Ping failed: " + error.message);
    } finally {
      claimFaucetRunning = false;
      updateFaucetSubMenuItems();
    }
  }

  async function claimFaucetPong() {
    if (claimFaucetRunning) {
      addLog("Claim Faucet Pong is already running.");
      return;
    }
    claimFaucetRunning = true;
    updateFaucetSubMenuItems();
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      let pk = PRIVATE_KEY.trim();
      if (!pk.startsWith("0x")) pk = "0x" + pk;
      const wallet = new ethers.Wallet(pk, provider);
      const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, PONG_ABI, wallet);
      const alreadyMinted = await pongContract.isMinter(wallet.address);
      if (alreadyMinted) {
        addLog("PONG Faucet has already been claimed.");
        return;
      }
      addLog("Claiming Faucet Pong...");
      const tx = await pongContract.mint({ value: 0 });
      addLog(`Transaction sent. Tx Hash: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog("Claim Faucet Pong successful!");
      await delay(5000);
      updateWalletData();
    } catch (error) {
      addLog("Claim Faucet Pong failed: " + error.message);
    } finally {
      claimFaucetRunning = false;
      updateFaucetSubMenuItems();
    }
  }

  async function updateWalletData() {
    try {
      if (!RPC_URL || !PRIVATE_KEY) {
        throw new Error("RPC_URL / PRIVATE_KEY is not defined in .env");
      }
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      let pk = PRIVATE_KEY.trim();
      if (!pk.startsWith("0x")) pk = "0x" + pk;
      const wallet = new ethers.Wallet(pk, provider);
      globalWallet = wallet;
      walletInfo.address = wallet.address;
      const balanceNative = await provider.getBalance(wallet.address);
      walletInfo.balanceNative = ethers.formatEther(balanceNative);
      if (PING_TOKEN_ADDRESS) {
        const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
        const pingBalance = await pingContract.balanceOf(wallet.address);
        walletInfo.balancePing = ethers.formatEther(pingBalance);
      }
      if (PONG_TOKEN_ADDRESS) {
        const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
        const pongBalance = await pongContract.balanceOf(wallet.address);
        walletInfo.balancePong = ethers.formatEther(pongBalance);
      }
      updateWallet();
      addLog("Balance & Wallet Updated!!");
    } catch (error) {
      addLog("Failed to fetch wallet data: " + error.message);
    }
  }

function updateWallet() {
  const shortAddress = walletInfo.address ? getShortAddress(walletInfo.address) : "N/A";
  const content = `{bold}{bright-blue-fg}Address    :{/bright-blue-fg}{/bold} {bold}{bright-magenta-fg}${shortAddress}{/bright-magenta-fg}{/bold}
â”œâ”€ {bold}{bright-yellow-fg}Native    :{/bright-yellow-fg}{/bold}{bold}{bright-green-fg} ${walletInfo.balanceNative}{/bright-green-fg}{/bold}
â”œâ”€ {bold}{bright-yellow-fg}Ping      :{/bright-yellow-fg}{/bold}{bold}{bright-green-fg} ${walletInfo.balancePing}{/bright-green-fg}{/bold}
â”œâ”€ {bold}{bright-yellow-fg}Pong      :{/bright-yellow-fg}{/bold}{bold}{bright-green-fg} ${walletInfo.balancePong}{/bright-green-fg}{/bold}
â””â”€ {bold}{bright-yellow-fg}Network   :{/bright-yellow-fg}{/bold}{bold}{bright-red-fg} ${walletInfo.network}{/bright-red-fg}{/bold}`;
  walletBox.setContent(content);
  safeRender();
}

  async function approveTokenForSwap(tokenAddress, spender, amount) {
    const erc20ABI = [
      "function approve(address spender, uint256 amount) returns (bool)"
    ];
    const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, globalWallet);
    const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const tx = await tokenContract.approve(spender, maxApproval);
    addLog(`Approval TX sent: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("Approval successful.");
  }

  async function autoSwapPingPong(totalSwaps) {
    try {
      if (!globalWallet) throw new Error("Wallet not initialized.");
      const swapContract = new ethers.Contract(swapContractAddress, swapContractABI, globalWallet);
      addLog(`Starting Auto Swap for ${totalSwaps} times.`);
      for (let i = 0; i < totalSwaps; i++) {
        if (autoSwapCancelled) {
          addLog("Auto Swap cancelled.");
          break;
        }
        const swapDirection = Math.random() < 0.5 ? "PongToPing" : "PingToPong";
        let tokenIn, tokenOut;
        if (swapDirection === "PongToPing") {
          tokenIn = PONG_TOKEN_ADDRESS;
          tokenOut = PING_TOKEN_ADDRESS;
        } else {
          tokenIn = PING_TOKEN_ADDRESS;
          tokenOut = PONG_TOKEN_ADDRESS;
        }
        const randomAmount = randomInRange(50, 200);
        const amountIn = ethers.parseUnits(randomAmount.toString(), 18);
        const tokenInName = getTokenName(tokenIn);
        const tokenOutName = getTokenName(tokenOut);
        addLog(`Swap ${i + 1}: Approving token ${tokenInName}...`);
        await approveTokenForSwap(tokenIn, swapContractAddress, amountIn);
        addLog(`Swap ${i + 1}: Swapping from ${tokenInName} -> ${tokenOutName} with amount ${randomAmount}`);
        const fee = 500;
        const recipient = globalWallet.address;
        const amountOutMin = 0;
        const sqrtPriceLimitX96 = 0n;
        try {
          const tx = await swapContract.exactInputSingle({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: recipient,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: sqrtPriceLimitX96
          });
          addLog(`Swap ${i + 1} TX sent: ${getShortHash(tx.hash)}`);
          await tx.wait();
          addLog(`Swap ${i + 1} successful.`);
          await updateWalletData();
        } catch (error) {
          addLog(`Swap ${i + 1} failed: ${error.message}`);
        }
        if (i < totalSwaps - 1) {
          const delayMs = randomInRange(20000, 50000);
          addLog(`Waiting ${delayMs / 1000} seconds before the next swap...`);
          await delay(delayMs);
        }
      }
      addLog("Auto Swap completed.");
      autoSwapRunning = false;
      updateSomniaSubMenuItems();
      updateFaucetSubMenuItems();
    } catch (err) {
      addLog("Error in Auto Swap: " + err.message);
      autoSwapRunning = false;
      updateSomniaSubMenuItems();
      updateFaucetSubMenuItems();
    }
  }

  function readRandomAddresses() {
    try {
      const data = fs.readFileSync("randomaddress.txt", "utf8");
      return data.split("\n").map(addr => addr.trim()).filter(addr => addr !== "");
    } catch (err) {
      addLog("Failed to read randomaddress.txt: " + err.message);
      return [];
    }
  }

  async function autoSendTokenRandom(totalSends, tokenAmountStr) {
    try {
      if (!globalWallet) throw new Error("Wallet not initialized.");
      const addresses = readRandomAddresses();
      if (addresses.length === 0) {
        addLog("Address list is empty.");
        return;
      }
      addLog(`Starting Auto Send Token to random addresses for ${totalSends} times.`);
      for (let i = 0; i < totalSends; i++) {
        if (autoSendCancelled) {
          addLog("Auto Send Token cancelled.");
          break;
        }
        const randomIndex = randomInRange(0, addresses.length - 1);
        const targetAddress = addresses[randomIndex];
        addLog(`Auto Send: Sending ${tokenAmountStr} STT to ${targetAddress}`);
        const tx = await globalWallet.sendTransaction({
          to: targetAddress,
          value: ethers.parseUnits(tokenAmountStr, 18)
        });
        addLog(`Auto Send ${i + 1}/${totalSends} TX sent: ${getShortHash(tx.hash)}`);
        await tx.wait();
        addLog(`Auto Send ${i + 1}/${totalSends} successful to ${targetAddress}.`);
        await updateWalletData();
        if (i < totalSends - 1) {
          const delayMs = randomInRange(5000, 10000);
          addLog(`Waiting ${delayMs / 1000} seconds before the next send...`);
          await delay(delayMs);
        }
      }
      addLog("Auto Send Token completed.");
      autoSendRunning = false;
      updateSendTokenSubMenuItems();
    } catch (err) {
      addLog("Error in Auto Send Token: " + err.message);
      autoSendRunning = false;
      updateSendTokenSubMenuItems();
    }
  }

  async function autoSendTokenChosen(targetAddress, tokenAmountStr) {
    try {
      if (!globalWallet) throw new Error("Wallet not initialized.");
      addLog(`Sending ${tokenAmountStr} STT to address ${targetAddress}`);
      const tx = await globalWallet.sendTransaction({
        to: targetAddress,
        value: ethers.parseUnits(tokenAmountStr, 18)
      });
      addLog(`Transaction sent. Tx Hash: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog(`Token sent to ${targetAddress} successfully.`);
      autoSendRunning = false;
      updateSendTokenSubMenuItems();
      await updateWalletData();
    } catch (err) {
      addLog("Error in Send Token: " + err.message);
      autoSendRunning = false;
      updateSendTokenSubMenuItems();
    }
  }

  function updateSomniaSubMenuItems() {
    if (autoSwapRunning) {
      somniaSubMenu.setItems([
        "Auto Swap PING & PONG",
        "Stop Transaction",
        "Clear Transaction Logs",
        "Back To Main Menu",
        "Exit"
      ]);
    } else {
      somniaSubMenu.setItems([
        "Auto Swap PING & PONG",
        "Clear Transaction Logs",
        "Back To Main Menu",
        "Exit"
      ]);
    }
    safeRender();
  }
  function updateFaucetSubMenuItems() {
    if (autoSwapRunning || claimFaucetRunning) {
      faucetSubMenu.setItems([
        "Claim Faucet Ping (disabled)",
        "Claim Faucet Pong (disabled)",
        "Stop Transaction",
        "Clear Transaction Logs",
        "Back To Main Menu",
        "Exit"
      ]);
    } else {
      faucetSubMenu.setItems([
        "Claim Faucet Ping",
        "Claim Faucet Pong",
        "Clear Transaction Logs",
        "Back To Main Menu",
        "Exit"
      ]);
    }
    safeRender();
  }
  function updateSendTokenSubMenuItems() {
    if (autoSendRunning) {
      sendTokenSubMenu.setItems([
        "Auto Send Random Address (disabled)",
        "Send To Chosen Address (disabled)",
        "Stop Transaction",
        "Clear Transaction Logs",
        "Back To Menu",
        "Exit"
      ]);
    } else {
      sendTokenSubMenu.setItems([
        "Auto Send Random Address",
        "Send To Chosen Address",
        "Clear Transaction Logs",
        "Back To Menu",
        "Exit"
      ]);
    }
    safeRender();
  }

const screen = blessed.screen({
  smartCSR: true,
  title: "Somnia Testnet Auto Swap, Claim Faucet & Auto Send Token",
  fullUnicode: true,
  mouse: true
});

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  tags: true,
  style: { fg: "white" }
});

figlet.text("SOMNIA AUTO SWAP", { font: "Standard", horizontalLayout: "default" }, (err, data) => {
  if (err) {
    headerBox.setContent("{center}{bold}SOMNIA AUTO SWAP{/bold}{/center}");
  } else {
    headerBox.setContent(`{center}{bold}{green-fg}${data}{/green-fg}{/bold}{/center}`);
  }
  safeRender();
});

const descriptionBox = blessed.box({
  left: "center",
  width: "100%",
  content: "{center}{bold}{bright-magenta-fg}=== Telegram Channel 📢 : FORESTARMY (@forestarmy) ==={/bright-magenta-fg}{/bold}{/center}",
  tags: true,
  style: { fg: "white" }
});

const logsBox = blessed.box({
  label: " Transaction Logs ",
  left: "0%",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
  style: {
    border: { fg: "red" },
    fg: "bright-cyan",
    bg: "default"
  }
});

const walletBox = blessed.box({
  label: " Wallet Information ",
  left: "60%",
  border: { type: "line" },
  tags: true,
  style: {
    border: { fg: "magenta" },
    fg: "white",
    bg: "default",
    align: "left",
    valign: "top"
  },
  content: ""
});

const mainMenu = blessed.list({
  label: " Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "green", fg: "black" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: ["Somnia Auto Swap", "Claim Faucet", "Auto Send Token", "Clear Transaction Logs", "Refresh", "Exit"]
});

const somniaSubMenu = blessed.list({
  label: " Somnia Auto Swap Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "blue", fg: "white" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: []
});
somniaSubMenu.hide();

const faucetSubMenu = blessed.list({
  label: " Claim Faucet Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "blue", fg: "white" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: []
});
faucetSubMenu.hide();

const sendTokenSubMenu = blessed.list({
  label: " Auto Send Token Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "magenta", fg: "white" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: []
});
sendTokenSubMenu.hide();

const promptBox = blessed.prompt({
  parent: screen,
  border: "line",
  height: "20%",
  width: "50%",
  bottom: "2%",
  top: "center",
  left: "center",
  label: "{bright-blue-fg}Swap Prompt{/bright-blue-fg}",
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  style: { fg: "bright-white", bg: "default", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(descriptionBox);
screen.append(logsBox);
screen.append(walletBox);
screen.append(mainMenu);
screen.append(somniaSubMenu);
screen.append(faucetSubMenu);
screen.append(sendTokenSubMenu);

screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.key(["C-up"], () => {
  logsBox.scroll(-1);
  safeRender();
});
screen.key(["C-down"], () => {
  logsBox.scroll(1);
  safeRender();
});

function adjustLayout() {
  const screenHeight = screen.height;
  const screenWidth = screen.width;
  const headerHeight = Math.max(8, Math.floor(screenHeight * 0.15));
  headerBox.height = headerHeight;
  headerBox.width = "100%";
  descriptionBox.top = "20%";
  descriptionBox.height = Math.floor(screenHeight * 0.05);
  logsBox.top = headerHeight + descriptionBox.height;
  logsBox.left = 0;
  logsBox.width = Math.floor(screenWidth * 0.6);
  logsBox.height = screenHeight - (headerHeight + descriptionBox.height);
  walletBox.top = headerHeight + descriptionBox.height;
  walletBox.left = Math.floor(screenWidth * 0.6);
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  mainMenu.top = headerHeight + descriptionBox.height + walletBox.height;
  mainMenu.left = Math.floor(screenWidth * 0.6);
  mainMenu.width = Math.floor(screenWidth * 0.4);
  mainMenu.height = screenHeight - (headerHeight + descriptionBox.height + walletBox.height);
  somniaSubMenu.top = mainMenu.top;
  somniaSubMenu.left = mainMenu.left;
  somniaSubMenu.width = mainMenu.width;
  somniaSubMenu.height = mainMenu.height;
  faucetSubMenu.top = mainMenu.top;
  faucetSubMenu.left = mainMenu.left;
  faucetSubMenu.width = mainMenu.width;
  faucetSubMenu.height = mainMenu.height;
  sendTokenSubMenu.top = mainMenu.top;
  sendTokenSubMenu.left = mainMenu.left;
  sendTokenSubMenu.width = mainMenu.width;
  sendTokenSubMenu.height = mainMenu.height;

  safeRender();
}

screen.on("resize", adjustLayout);
adjustLayout();

safeRender();
mainMenu.focus();
updateLogs();
updateWalletData();

mainMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Somnia Auto Swap") {
    showSomniaSubMenu();
  } else if (selected === "Claim Faucet") {
    showFaucetSubMenu();
  } else if (selected === "Auto Send Token") {
    showSendTokenSubMenu();
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Refresh") {
    updateWalletData();
    updateLogs();
    safeRender();
    addLog("Refreshed");
    mainMenu.focus();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

function showSomniaSubMenu() {
  mainMenu.hide();
  faucetSubMenu.hide();
  sendTokenSubMenu.hide();
  updateSomniaSubMenuItems();
  somniaSubMenu.show();
  somniaSubMenu.focus();
  safeRender();
}
somniaSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Auto Swap PING & PONG") {
    if (autoSwapRunning) {
      addLog("Transaction is currently running, cannot start a new transaction.");
      return;
    }
    promptBox.setFront();
    promptBox.readInput("Enter the number of swaps:", "", async (err, value) => {
      promptBox.hide();
      safeRender();
      if (err || !value) {
        addLog("Input is invalid or cancelled.");
        return;
      }
      const totalSwaps = parseInt(value);
      if (isNaN(totalSwaps) || totalSwaps <= 0) {
        addLog("Invalid number of swaps.");
        return;
      }
      autoSwapRunning = true;
      autoSwapCancelled = false;
      updateSomniaSubMenuItems();
      updateFaucetSubMenuItems();
      await autoSwapPingPong(totalSwaps);
      autoSwapRunning = false;
      updateSomniaSubMenuItems();
      updateFaucetSubMenuItems();
    });
  } else if (selected === "Stop Transaction") {
    if (!autoSwapRunning) {
      addLog("No transaction is currently running.");
      return;
    }
    autoSwapCancelled = true;
    addLog("Stop Transaction command received (Somnia).");
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    somniaSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

function showFaucetSubMenu() {
  mainMenu.hide();
  somniaSubMenu.hide();
  sendTokenSubMenu.hide();
  updateFaucetSubMenuItems();
  faucetSubMenu.show();
  faucetSubMenu.focus();
  safeRender();
}
faucetSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Stop Transaction") {
    if (autoSwapRunning || claimFaucetRunning) {
      claimFaucetCancelled = true;
      addLog("Stop Transaction command received (Faucet).");
    } else {
      addLog("No transaction is currently running.");
    }
    return;
  }
  if ((autoSwapRunning || claimFaucetRunning) && (selected.includes("Claim Faucet Ping") || selected.includes("Claim Faucet Pong"))) {
    addLog("A transaction is currently running. Please stop the transaction first before claiming the faucet.");
    return;
  }
  if (selected.includes("Claim Faucet Ping")) {
    claimFaucetPing();
  } else if (selected.includes("Claim Faucet Pong")) {
    claimFaucetPong();
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    faucetSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

function showSendTokenSubMenu() {
  mainMenu.hide();
  somniaSubMenu.hide();
  faucetSubMenu.hide();
  updateSendTokenSubMenuItems();
  sendTokenSubMenu.show();
  sendTokenSubMenu.focus();
  safeRender();
}

sendTokenSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Auto Send Random Address") {
    if (autoSendRunning) {
      addLog("Auto Send transaction is currently running, cannot start a new transaction.");
      return;
    }
    promptBox.setFront();
    promptBox.readInput("Enter the number of sends:", "", async (err, value) => {
      promptBox.hide();
      safeRender();
      if (err || !value) {
        addLog("Input for the number of sends is invalid or cancelled.");
        return;
      }
      const totalSends = parseInt(value);
      if (isNaN(totalSends) || totalSends <= 0) {
        addLog("Invalid number of sends.");
        return;
      }
      promptBox.setFront();
      promptBox.readInput("Enter the token amount (STT) to send (min 0.0001, max 0.01):", "", async (err2, tokenAmt) => {
        promptBox.hide();
        safeRender();
        if (err2 || !tokenAmt) {
          addLog("Input for token amount is invalid or cancelled.");
          return;
        }
        let amt = parseFloat(tokenAmt);
        if (isNaN(amt)) {
          addLog("Token amount must be a number.");
          return;
        }
        if (amt < 0.0001 || amt > 0.01) {
          addLog("Token amount must be between 0.0001 and 0.01 STT.");
          return;
        }
        autoSendRunning = true;
        autoSendCancelled = false;
        updateSendTokenSubMenuItems();
        await autoSendTokenRandom(totalSends, tokenAmt);
        autoSendRunning = false;
        updateSendTokenSubMenuItems();
      });
    });
  } else if (selected === "Send To Chosen Address") {
    if (autoSendRunning) {
      addLog("Auto Send transaction is currently running, cannot start a new transaction.");
      return;
    }
    promptBox.setFront();
    promptBox.readInput("Enter the target address:", "", async (err, target) => {
      promptBox.hide();
      safeRender();
      if (err || !target) {
        addLog("Input address is invalid or cancelled.");
        return;
      }
      promptBox.setFront();
      promptBox.readInput("Enter the token amount (STT) to send:", "", async (err2, tokenAmt) => {
        promptBox.hide();
        safeRender();
        if (err2 || !tokenAmt) {
          addLog("Input for token amount is invalid or cancelled.");
          return;
        }
        let amt = parseFloat(tokenAmt);
        if (isNaN(amt)) {
          addLog("Token amount must be a number.");
          return;
        }
        autoSendRunning = true;
        autoSendCancelled = false;
        updateSendTokenSubMenuItems();
        await autoSendTokenChosen(target, tokenAmt);
        autoSendRunning = false;
        updateSendTokenSubMenuItems();
      });
    });
  } else if (selected === "Stop Transaction") {
    if (autoSendRunning) {
      autoSendCancelled = true;
      addLog("Stop Transaction command received (Auto Send).");
    } else {
      addLog("No transaction is currently running.");
    }
    return;
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Menu") {
    sendTokenSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});
