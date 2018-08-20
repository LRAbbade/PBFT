const Blockchain = require('./blockchain');
const express = require('express');
const app = express(); 
const bodyParser = require('body-parser');      //convert req in json
const rp = require('request-promise');
const request = require('request');
const uuid = require('uuid/v1');
const prompt = require('prompt');
const PORT = Number(process.argv[2]);
const nodeAddress = process.argv[3];
const nodeType = process.argv[4];
const nodeUuid = uuid().split('-').join('');

const blockchain = new Blockchain();
var networkNodes = [];
var masterNodes = [];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }))

if (!(PORT && nodeAddress && nodeType) || (nodeType !== "master" && nodeType !== "network")) {    // TODO make this safe check better
    throw `PORT, nodeAddress or nodeType are incorrect, current values: ${PORT} ${nodeAddress} ${nodeType}`;
}

const isMasterNode = (nodeType === 'master');

app.get('/', function (req, res) {
    res.json({
        note: `Node ${nodeUuid} running on port ${PORT}`,
        "nodeId": nodeUuid,
        "nodeAddress": nodeAddress,
        "nodeType": nodeType,
        "masterNodes": masterNodes,
        "networkNodes": networkNodes
    });
});

app.get('/blockchain', function (req, res) {
    res.send(blockchain);
});

function isValidRegisterRequest(reqAddress, reqType) {
    const nodeNotAlreadyPresent = (networkNodes.indexOf(reqAddress) == -1) && (masterNodes.indexOf(reqAddress) == -1);
    const notCurrentNode = nodeAddress != reqAddress;
    const validReqType = (reqType === "master") || (reqType === "network");
    return (nodeNotAlreadyPresent && notCurrentNode && validReqType && reqAddress && reqType);
}

function getNodesStatus() {
    return {
        note: `${masterNodes.length} master node(s) and ${networkNodes.length} network node(s) active`,
        "masterNodes": masterNodes,
        "networkNodes": networkNodes
    };
}

function makeRegisterRequest(networkNodeUrl, reqAddress, reqType) {
    return {
        uri: networkNodeUrl + '/register-node',
        method: 'POST',
        body: {
            "nodeAddress": reqAddress,
            "nodeType": reqType
        },
        json: true
    };
}

app.post('/register-and-broadcast-node', function (req, res) {
    const reqAddress = req.body.nodeAddress;
    const reqType = req.body.nodeType;
    if (isValidRegisterRequest(reqAddress, reqType)){
        reqType === "master" ? masterNodes.push(reqAddress) : networkNodes.push(reqAddress);
    }

    const regNodesPromises = [];

    for (var i = 0; i < masterNodes.length; i++) {
        regNodesPromises.push(rp(makeRegisterRequest(masterNodes[i], reqAddress, reqType)));
    }
    for (var i = 0; i < networkNodes.length; i++) {
        regNodesPromises.push(rp(makeRegisterRequest(networkNodes[i], reqAddress, reqType)));
    }

    Promise.all(regNodesPromises)
        .then(data => {
            res.json(getNodesStatus());
        })
});

app.post('/register-node', function (req, res) {
    const reqAddress = req.body.nodeAddress;
    const reqType = req.body.nodeType;

    if (!isValidRegisterRequest(reqAddress, reqType)) {
        res.json({
            note: `Invalid request for registering node`
        });
    } else {
        reqType === "master" ? masterNodes.push(reqAddress) : networkNodes.push(reqAddress);
        res.json({
            note: `Node registered successfully on node ${nodeUuid}, ${nodeAddress}`
        });
    }
});

app.get('/nodes', function (req, res) {
    res.json(getNodesStatus());
});

// receive a yes-no vote on a determined block
app.post('/receive-vote', function (req, res) {

});

function makeVoteEmissionRequest(networkNodeUrl, newBlockHash, vote) {
    return {
        uri: networkNodeUrl + '/validate',
        method: 'POST',
        body: {
            "newBlockHash": newBlockHash,
            "vote": vote,
            "nodeAddress": nodeAddress
        },
        json: true
    };
}

app.post('/validate', function (req, res) {
    if (!isValidMeta(req.body.originalBody)) {
        res.json({
            note: `Invalid car metadata`,
            vote: "no"
        });
    } else {
        blockchain.onHold = req.body.createdBlock;

        const newBlockHash = req.body.createdBlock['hash'];
        const isValidBlock = blockchain.isValidNewBlock(req.body.createdBlock);
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
                    "nodeAddress": nodeAddress,
                    vote: "yes"
                });
            });
    }
});

function isValidCarPlate(plate) {
    // TODO
    return (!!plate);
}

function isValidSignature(body) {
    // TODO: check if req signature matches RSA key
    return (!!body);
}

function isValidMeta(body) {
    return (isValidCarPlate(body.carPlate) && isValidSignature(body));
}

function makeValidationRequest(networkNodeUrl, body, createdBlock) {
    return {
        uri: networkNodeUrl + '/validate',
        method: 'POST',
        body: {
            "originalBody": body,
            "createdBlock": createdBlock
        },
        json: true
    };
}

// Byzantine fault tolerance
function getMinVotesRequired() {
    return Math.floor(2/3 * (masterNodes.length + networkNodes.length)) + 1;
}

app.post('/createBlock', function (req, res) {
    if (!isMasterNode) {
        res.json({
            note: `This node (${nodeAddress}) has no permission to create blocks. To create a new block send a request to a master node`
        });
    } else if (!isValidMeta(req.body)) {
        res.json({
            note: `Invalid request details`
        });
    } else {
        const createdBlock = blockchain.createBlock(blockchain.getLastBlock['hash'], req.body.carPlate, req.body.block);
        blockchain.onHold = createdBlock;

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
                const totalVotes = body.length;
                var positiveVotes = 0;

                body.forEach(function(res) {
                    if (res['vote'] === 'yes') positiveVotes++;
                });

                const blockAccepted = positiveVotes >= getMinVotesRequired();

                if (blockAccepted) {
                    blockchain.addBlockOnHold();
                } else {
                    blockchain.discardBlockOnHold();
                }

                res.json({
                    "blockAccepted": blockAccepted,
                    results: body
                });
            })
            .catch(function(err) {
                res.json({
                    note: "Connection error with network"
                });
            });
    }
});

function isValidNodeAddress(nodeAddress) {
    // TODO validate node address
    return (!!nodeAddress);
}

console.log("Input any master node in the network for initialization, if this is the first node, just input 'this'");

prompt.start();
prompt.get(['masterNodeAddress'], function (err, result) {
    prompt.stop();

    if (result.masterNodeAddress === 'this'){
        if (!isMasterNode) {
            throw `A common network node cannot be a master node, node type: ${nodeType}`;
        } else {
            masterNodes.push(nodeAddress);
        }
    } else {
        if (!isValidNodeAddress(result.masterNodeAddress)) {
            throw `Master node address invalid: ${result.masterNodeAddress}`;
        }

        // TODO: request master nodes from company's API

        request.post({"url": result.masterNodeAddress + '/register-and-broadcast-node', 
                      "form": {"nodeAddress": nodeAddress, "nodeType": nodeType}}, 
                     function (err, res, body) {

            body = JSON.parse(body);
            if (!body['masterNodes'].length) {      // there should be at least 1 master node in the network
                throw `Could not retrieve nodes from ${result.masterNodeAddress}`;
            }

            masterNodes = body['masterNodes'];
            networkNodes = body['networkNodes'];
        });
    }

    app.listen(PORT, function () {
        console.log(`Listening on port ${PORT}...`);
    });
});