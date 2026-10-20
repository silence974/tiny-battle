#!/usr/bin/env node

function help() {
  console.log('Usage: npm run agent:step -- --link <seat-link> --client <id> [--name <name> --url <url> --key <publishable-key>');
  console.log('       npm run agent:act -- --link <seat-link> --client <id> --action \'{"type":"pass"}\'');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  help();
  process.exit(0);
}

function value(flag, fallback = '') {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const Room = require('./supabase-room');
  const { createAgentClient } = require('./agent-client');
  const config = {
    url: value('--url', process.env.SUPABASE_URL),
    publishableKey: value('--key', process.env.SUPABASE_PUBLISHABLE_KEY),
  };
  const link = value('--link', process.env.AGENT_LINK);
  const clientId = value('--client', process.env.AGENT_CLIENT_ID);
  const name = value('--name', process.env.AGENT_NAME || clientId);
  if (!link || !clientId || !config.url || !config.publishableKey) throw new Error('需要 --link、--client、--url、--key，或对应环境变量');
  const transport = Room.createRoomTransport({ config, client: createClient(config.url, config.publishableKey) });
  const agent = createAgentClient({ transport, link, clientId, name });
  await agent.join();
  const snapshot = await agent.snapshot();
  if (args.includes('--act')) {
    const action = JSON.parse(value('--action', '{"type":"pass"}'));
    console.log(JSON.stringify(await agent.act(action)));
  } else {
    console.log(JSON.stringify({ seq: snapshot.seq, phase: snapshot.phase, legalActions: snapshot.legalActions || [] }));
  }
  await agent.leave();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
