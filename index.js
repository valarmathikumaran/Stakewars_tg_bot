import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { TelegramBot } from "./src/TelegramBot.js";
import { NodeFetcher } from "./src/NodeFetcher.js";
import {
  getChunksBlocksStat,
  prepareSwitchingEpochInfo,
} from "./src/helpers.js";
import { exec } from "child_process";

dotenv.config({ path: "./config.env" });
const __dirname = path.resolve();

const STATE_FILE = __dirname + "/.prev_state.json";

let prev_state;
try {
  prev_state = fs.readFileSync(STATE_FILE, { encoding: "utf8", fd: null });
} catch (error) {
  // do nothing, script create the file in end of script
}

const { TG_API_KEY, TG_CHAT_ID, NODE_RPC, POOL_ID } = process.env;

const tgBot = new TelegramBot(TG_API_KEY, TG_CHAT_ID);
const nodeFetcher = new NodeFetcher(NODE_RPC, POOL_ID);

/**callback to find my pool id in different arrays*/
const findMyPoolId = (pool) => pool.account_id === POOL_ID;

const main = async () => {
  try {
    const node = await nodeFetcher.ping();

    const networkInfo = await nodeFetcher.network();
    const { num_active_peers } = await networkInfo.json();

    const { validator_account_id, protocol_version, latest_protocol_version } = await node.json();

    const status = await nodeFetcher.checkValidators();
    const { result } = await status.json();

    const myKickoutState = result.prev_epoch_kickout.find(findMyPoolId);
    const myValidatorState = result.current_validators.find(findMyPoolId);
    const myNextValidatorsState = result.next_validators.find(findMyPoolId);
    const epochStartHeight = result.epoch_start_height;
    const epochHeight = result.epoch_height;

    const newState = {
      myKickoutState,
      myValidatorState,
      myNextValidatorsState,
      epochStartHeight,
    };

    const newStateString = JSON.stringify(newState, null, 2);

    console.log("version" + protocol_version)
    console.log("latest" + latest_protocol_version)
        console.log("Connected Peers: " + num_active_peers)

    await tgBot.sendMessage("protocol version: " + protocol_version + "\n" + "Near latest version: " + latest_protocol_version + "\n" + "Connected Peers: " + num_active_peers);

    //if states are equals then do nothing
    //if (newStateString === prev_state) return;

    let oldState;
    if (prev_state) oldState = JSON.parse(prev_state);

    // rewrite new state
    fs.writeFileSync(STATE_FILE, newStateString);

    // Notify if epoch has changed
    if (newState.epochStartHeight !== oldState?.epochStartHeight) {
      const msg = prepareSwitchingEpochInfo(epochHeight, oldState, newState);
      await tgBot.sendMessage(msg);
    }

    if (newState.myValidatorState) {
      // if percentage of expected/produced chunks was lower less than 80%
      const {
        num_expected_chunks: expectedChunks,
        num_produced_chunks: producedChunks,
        num_expected_blocks: expectedBlocks,
        num_produced_blocks: producedBlocks,
      } = newState.myValidatorState;

      const chunksRatio = producedChunks / expectedChunks;
      const blocksRatio = producedBlocks / expectedBlocks;

      const trigger = chunksRatio < 0.8 || blocksRatio < 0.8;

      /* trigger is ratio prodused/expected <80%
       * expectedChunks >= 4 is condition to avoid messages if the first or second expected chanks was failed
       */
      if (trigger && expectedChunks >= 4) {
        const msgRows = [
          "⚠ SOMETHIG WRONG!",
          "Your node has produced lower than expected",
          getChunksBlocksStat("Productivity", newState.myValidatorState),
        ];
        await tgBot.sendMessage(msgRows.join("\n"));
      }
    }

    if (validator_account_id !== POOL_ID)
      throw Error(`POOL ID PROBLEMS: \n${POOL_ID} !== ${validator_account_id}`);
  } catch (error) {
    // if there is error then something wrong with node
    console.log(error);
    await tgBot.sendMessage("🚨 ERROR 🚨\n" + error.message);
  }
    //const { exec } = require("child_process");

    console.log("=======>");
    exec('NEAR_ENV=shardnet near validators next | grep "seat price"', async (error, stdout, stderr) => {
        console.log("stdout: " + stdout);
            await tgBot.sendMessage(" Next Seat Price \n" + stdout);
        console.log("stderr: " + stderr);
        if (error !== null) {
                console.log("exec error: " + error);
        }
    }); 
};

main();
