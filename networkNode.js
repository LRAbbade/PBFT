const Blockchain = require('./blockchain');
const express = require('express');
const app = express(); 
const bodyParser = require('body-parser');      //convert req in json
const rp = require('request-promise');
const request = require('request');
const uuid = require('uuid/v1');
const prompt = require('prompt');
const nodeType = process.argv[2];
const blockchainType = process.argv[3];
const nodeIp = process.argv[4];
const nodeUuid = uuid().split('-').join('');
const PORT = 3002

const blockchain = new Blockchain();
var networkNodes = [];
var masterNodes = [];

// Byzantine fault tolerance
function getMinVotesRequired() {
    return Math.floor(2 / 3 * (masterNodes.length + networkNodes.length)) + 1;
}

function getNodesStatus() {
    return {
        note: `${masterNodes.length} master node(s) and ${networkNodes.length} network node(s) active`,
        "masterNodes": masterNodes,
        "networkNodes": networkNodes
    };
}

function getLastBlocks(count) {
    const size = blockchain.chain.length
    return blockchain.chain.slice(size - count, size)
}

function isValidIp(ip) {
    // TODO: add a regex check
    return !!ip;
}

function isValidCarPlate(plate) {
    // TODO: check plate
    return (!!plate);
}

function isValidSignature(body) {
    // TODO: check if req signature matches RSA key
    return (!!body);
}

function isValidMeta(body) {
    return (isValidCarPlate(body.carPlate) && isValidSignature(body));
}

function isValidRegisterRequest(reqAddress, reqType) {
    const nodeNotAlreadyPresent = (networkNodes.indexOf(reqAddress) == -1) && (masterNodes.indexOf(reqAddress) == -1);
    const notCurrentNode = nodeIp != reqAddress;
    const validReqType = (reqType === "master") || (reqType === "network");
    return (nodeNotAlreadyPresent && notCurrentNode && validReqType && reqAddress && reqType);
}

function isValidMasterNode(nodeAddress) {
    // TODO validate master node address on enterprise website
    return (!!nodeAddress);
}

function makeVoteEmissionRequest(networkNodeUrl, newBlockHash, vote) {
    return {
        uri: `${networkNodeUrl}/receive-vote`,
        method: 'POST',
        body: {
            "newBlockHash": newBlockHash,
            "vote": vote,
            "nodeAddress": nodeIp
        },
        json: true
    };
}

function makeValidationRequest(networkNodeUrl, body, createdBlock) {
    return {
        uri: `${networkNodeUrl}/validate`,
        method: 'POST',
        body: {
            "originalBody": body,
            "createdBlock": createdBlock
        },
        json: true
    };
}

function makeRegisterRequest(networkNodeUrl, reqAddress, reqType) {
    return {
        uri: `${networkNodeUrl}/register-node`,
        method: 'POST',
        body: {
            nodeAddress: reqAddress,
            nodeType: reqType
        },
        json: true
    };
}

function makeFullDownloadRequest(networkNodeUrl, page) {
    return {
        url: `${networkNodeUrl}/blockchain/${page}`,
        method: 'GET',
        json: true
    };
}

function fullUpdateBlockchain(url, callback) {
    request(url, function(err, res, body) {
        body = JSON.parse(body);
        blockchain = blockchain.chain.concat(body['chain']);
        
        if (body["nextUrl"] !== "none") fullUpdateBlockchain(body["nextUrl"], callback)
        else callback()
    })
}

function activeEndpoints() {
    console.log('Activating endpoints...')
    /* console.log(blockchain.chain) */

    app.get('/', function (req, res) {
        res.json({
            note: `Node running on address: ${nodeIp}`,
            "nodeId": nodeUuid,
            "nodeType": nodeType,
            "masterNodes": masterNodes,
            "networkNodes": networkNodes
        });
    });
    
    app.get('/blockchain', function (req, res) {
        res.send(blockchain);
    });

    app.get('/blockchain/:page', function (req, res) {
        const page = Number(req.params.page)
        const totalPages = Math.ceil(blockchain.chain.length / 100)
        const previous = page - 1 >= 0 ? page - 1 : -1
        const next = page + 1 < totalPages ? page + 1 : -1

        const start = page * 100
        const end = start + 100
    
        const response = {
            totalPages: totalPages,
            baseUrl: `${nodeIp}/blockchain/`,
            previousUrl: previous !== -1 ? `${nodeIp}/blockchain/${previous}` : `none`,
            nextUrl: next !== -1 ? `${nodeIp}/blockchain/${next}` : `none`,
            chain: blockchain.chain.slice(start, end)
        }

        res.send(response)
    })
    
    app.get('/nodes', function (req, res) {
        res.json(getNodesStatus());
    });
    
    app.post('/receive-vote', function (req, res) {
        const blockHash = req.body.newBlockHash;
        const vote = req.body.vote;
        console.log(`Vote ${vote} by ${req.body.nodeAddress} was received on block ${blockHash}`);
        const results = blockchain.processVote(blockHash, req.body.nodeAddress, vote);
    
        if (results.yesVotes >= getMinVotesRequired()) {
            console.log(`Consensus was reached, new block (${blockHash}) added to the blockchain`);
            blockchain.addBlockOnHold();
        } else if (results.totalVotes >= masterNodes.length + networkNodes.length) { // should never be greater, but just in case
            console.log(`Consensus was NOT reached, new block (${blockHash}) was discarded`);
            blockchain.discardBlockOnHold();
        }
    
        res.json({
            note: `Vote on block ${req.body.newBlockHash} acknowledged by node ${nodeIp}`
        });
    });
    
    app.post('/validate', function (req, res) {
        if (!isValidMeta(req.body.originalBody)) {
            res.json({
                note: `Invalid car metadata`,
                vote: "no"
            });
        } else {
            console.log(`Starting validation on block ${req.body.createdBlock['hash']}`);
            console.log(`Block received from: ${req.connection.remoteAddress}`);
            // TODO: check if ip of sender matches any master node ip
    
            blockchain.putBlockOnHold(req.body.createdBlock);
    
            const newBlockHash = req.body.createdBlock['hash'];
            const validationResult = blockchain.isValidNewBlock(req.body.createdBlock);
            const isValidBlock = validationResult.isValid;
    
            if (!isValidBlock) {
                console.log(`block ${newBlockHash} is NOT valid, details as follows:`);
                console.log(validationResult.details);
            }
    
            const vote = isValidBlock ? "yes" : "no";
    
            // broadcast vote to every node for validation
            const sendVotePromises = [];
            for (var i = 0; i < masterNodes.length; i++) {
                sendVotePromises.push(rp(makeVoteEmissionRequest(masterNodes[i], newBlockHash, vote)));
            }
            for (var i = 0; i < networkNodes.length; i++) {
                sendVotePromises.push(rp(makeVoteEmissionRequest(networkNodes[i], newBlockHash, vote)));
            }
    
            Promise.all(sendVotePromises)
                .then(function (body) {
                    res.json({
                        note: `Block ${newBlockHash} processed and vote ${vote} transmitted to the network`,
                        "nodeAddress": nodeIp
                    });
                });
        }
    });

    app.post('/createBlock', function (req, res) {
        if (!isMasterNode) {
            res.json({
                note: `This node (${nodeIp}) has no permission to create blocks. To create a new block send a request to a master node`
            });
        } else if (!isValidMeta(req.body)) {
            res.json({
                note: `Invalid request details`
            });
        } else {
            console.log(`Creating block for car ${req.body.carPlate} and broadcasting to network`);
            const createdBlock = blockchain.createBlock(blockchain.getLastBlock()['hash'], req.body.carPlate, req.body.block);
    
            // broadcast block to every node for validation
            const validateNodesPromises = [];
            for (var i = 0; i < masterNodes.length; i++) {
                validateNodesPromises.push(rp(makeValidationRequest(masterNodes[i], req.body, createdBlock)));
            }
            for (var i = 0; i < networkNodes.length; i++) {
                validateNodesPromises.push(rp(makeValidationRequest(networkNodes[i], req.body, createdBlock)));
            }
    
            Promise.all(validateNodesPromises)
                .then(function(body) {          // body is an array with the result of each request
                    res.json({
                        note: `Block ${createdBlock['hash']} created and transmitted to the network for validation`,
                        block: createdBlock
                    });
                });
        }
    });

    app.post('/register-node', function (req, res) {
        console.log(`Received register request from ${req.connection.remoteAddress}: ${req.body}`);
        const reqAddress = req.body.nodeAddress;
        const reqType = req.body.nodeType;
    
        if (!isValidRegisterRequest(reqAddress, reqType)) {
            res.json({
                note: `Invalid request for registering node`
            });
        } else {
            reqType === "master" ? masterNodes.push(reqAddress) : networkNodes.push(reqAddress);
            res.json({
                note: `Node registered successfully on node ${nodeUuid}, ${nodeIp}`
            });
        }
    });
    
    app.post('/register-and-broadcast-node', function (req, res) {
        console.log(`Received request from ${req.connection.remoteAddress} to join network: ${req.body}`);
        const reqType = req.body.nodeType;
        const reqBcType = req.body.blockchainType;
        const reqAddress = req.body.nodeIp;
        
        const regNodesPromises = [];
        for (var i = 0; i < masterNodes.length; i++) {
            regNodesPromises.push(rp(makeRegisterRequest(masterNodes[i], reqAddress, reqType)));
        }
        for (var i = 0; i < networkNodes.length; i++) {
            regNodesPromises.push(rp(makeRegisterRequest(networkNodes[i], reqAddress, reqType)));
        }
    
        Promise
            .all(regNodesPromises)
            .then(() => {
                const nodeStatus = getNodesStatus()
                nodeStatus.data = reqBcType === "full" ? `${nodeIp}/blockchain/0` : getLastBlocks(10)

                res.json(nodeStatus)
            })
    });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }))

if ((nodeType !== "master" && nodeType !== "network") ||
    (blockchainType !== "full" && blockchainType !== "light") ||
    !isValidIp(nodeIp)) {
    throw `nodeType or ip is incorrect, current values: ${nodeType}, ${blockchainType}, ${nodeIp}`;
}

const isMasterNode = (nodeType === 'master');

console.log("Input any master node in the network for initialization, if this is the first node, just input 'this'");

prompt.start();
prompt.get(['masterNodeAddress'], function (err, result) {
    prompt.stop();

    if (result.masterNodeAddress === 'this') {
        if (!isMasterNode) {
            throw `A common network node cannot be a master node, node type: ${nodeType}`;
        } else {
            masterNodes.push(nodeIp);
            activeEndpoints();
        }
    } else {
        if (!isValidMasterNode(result.masterNodeAddress)) {
            throw `Master node address invalid: ${result.masterNodeAddress}`;
        }

        // TODO: request master nodes from company's API

        request.post({
            url: `${result.masterNodeAddress}:${PORT}/register-and-broadcast-node`, 
            form: { nodeType, blockchainType, nodeIp }
        }, function (err, res, body) {
            body = JSON.parse(body);

            if (!body['masterNodes'].length) {      // there should be at least 1 master node in the network
                throw `Could not retrieve nodes from ${result.masterNodeAddress}`;
            }

            if (blockchainType === "full") {
                blockchain.chain = [];

                fullUpdateBlockchain(body['data'], () => {
                    masterNodes = body['masterNodes'];
                    networkNodes = body['networkNodes'];

                    activeEndpoints();
                })
            } else if (blockchainType === "light") {
                blockchain.chain = body['data'];

                masterNodes = body['masterNodes'];
                networkNodes = body['networkNodes'];

                activeEndpoints();
            } else {
                // TODO unregister from network
            }
        });
    }

    app.listen(PORT, function () {
        console.log(`Listening on port ${PORT}...`);
    });
});