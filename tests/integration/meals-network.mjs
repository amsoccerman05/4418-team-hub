// Resolve only the database container created by this disposable test run.
// Using its inspected private address avoids an Edge Node-DNS compatibility bug
// for Docker-only hostnames. This does not change production network settings.
import assert from 'node:assert/strict';
export function ownedMealsDatabaseAddress(containers, network, project) {
  assert(/^fabrication-it-[a-f0-9]{8}-[a-f0-9]{3}$/.test(project), 'Expected a fresh synthetic project identifier');
  assert(network && network.Name === `${project}-loopback` && /^[a-f0-9]{64}$/.test(network.Id), 'Unexpected disposable network');
  assert.equal(network.Labels?.['fabrication.integration'], project, 'Network is not owned by this test run');
  assert(Array.isArray(containers), 'Container inspection is required');
  const matching = containers.filter(container => container.Name === `/supabase_db_${project}`);
  assert.equal(matching.length, 1, 'Expected exactly one owned database container');
  const container = matching[0];
  assert(container.State?.Running === true && /^[a-f0-9]{64}$/.test(container.Id), 'Owned database container must be running');
  const connection = container.NetworkSettings?.Networks?.[network.Name];
  assert(connection && connection.NetworkID === network.Id, 'Database is not on the exact owned network');
  assert(network.Containers?.[container.Id]?.Name === container.Name.slice(1), 'Network membership does not match the owned database');
  const address = connection.IPAddress;
  assert(typeof address === 'string' && /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address), 'Expected a canonical private IPv4 address');
  const octets = address.split('.').map(Number);
  assert(octets.every(n => n <= 255) && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)), 'Only RFC1918 database addresses are allowed');
  assert.equal(network.Containers[container.Id].IPv4Address?.split('/')[0], address, 'Container and network inspections disagree');
  return address;
}
