const Blockchain = require('./blockchain');
const VotingStatistics = require('./votingStatistics');
const express = require('express');
const app = express(); 
const bodyParser = require('body-parser');      //convert req in json
const rp = require('request-promise');
const request = require('request');
const uuid = require('uuid/v1');
const nodeType = process.argv[2];
const blockchainType = process.argv[3];
const nodeIp = process.argv[4];
const masterAddress = process.argv[5];
const nodeUuid = uuid().split('-').join('');
const PORT = 3002;
const runningSince = (new Date()).toISOString().replace("T", " ").replace(/\.\d+.*/, "");

const blockchain = new Blockchain();
var isBlockchainAvailable = false;
var networkNodes = [];
var masterNodes = [];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }))

const log = _str => {
    if (typeof _str === 'object') {
        _str = JSON.stringify(_str);
    }
    console.log(`[${getCurrentTimestamp()}]: ${_str}`);
};

function removeItem(array, val) {
    const index = array.indexOf(val);
    if (index > -1) {
        return array.splice(index, 1);
    }
    throw `${val} not found`
}

var votingStatistics = null;

function isEndpointEnabled(req, res, callback) {
    isBlockchainAvailable ? callback() : res.json({ note: "This endpoint isn't available!" })
}

function isValidIp(ip) {
    // TODO: add a regex check
    return !!ip;
}

if ((nodeType !== "master" && nodeType !== "network") ||
    (blockchainType !== "full" && blockchainType !== "light") ||
    !isValidIp(nodeIp)) {
    throw `nodeType or ip is incorrect, current values: ${nodeType}, ${blockchainType}, ${nodeIp}`;
}

const isMasterNode = (nodeType === 'master');
log(`Starting ${nodeType} node at ${runningSince}`);

function getURI(ip, route) {
    return `http://${ip}:${PORT}${route}`;
}

function makePostRequest(ip, route, bodyJSON) {
    return {
        uri: getURI(ip, route),
        method: 'POST',
        body: bodyJSON,
        json: true
    };
}

app.get('/', function (req, res) {
    isEndpointEnabled(req, res, () => {
        res.json({
            note: `Node running on address: ${nodeIp}`,
            "nodeId": nodeUuid,
            "nodeType": nodeType,
            "runningSince": runningSince,
            "masterNodes": masterNodes,
            "networkNodes": networkNodes
        });
    });
});

app.get('/blockchain', function (req, res) {
    isEndpointEnabled(req, res, () => res.send(blockchain));
});

app.get('/blockchain/size', (req, res) => {
    isEndpointEnabled(req, res, () => { 
        res.json({
            'blockchainLength': blockchain.chain.length
        });
    });
});

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

app.get('/blockchain/:page', function (req, res) {
    isEndpointEnabled(req, res, () => {
        const page = Number(req.params.page);
        const totalPages = Math.ceil(blockchain.chain.length / 100);
        const previous = page - 1 >= 0 ? page - 1 : -1;
        const next = page + 1 < totalPages ? page + 1 : -1;

        const start = page * 100;
        const end = start + 100;

        const response = {
            totalPages: totalPages,
            baseUrl: getURI(nodeIp, '/blockchain/'),
            previousUrl: previous !== -1 ? getURI(nodeIp, `/blockchain/${previous}`) : `none`,
            nextUrl: next !== -1 ? getURI(nodeIp, `/blockchain/${next}`) : `none`,
            chain: blockchain.chain.slice(start, end)
        }

        res.send(response)
    });
})

app.get('/nodes', function (req, res) {
    isEndpointEnabled(req, res, () => res.json(getNodesStatus()));
});

function makeVoteEmissionRequest(networkNodeUrl, newBlockHash, newBlockIndex, vote) {
    return makePostRequest(networkNodeUrl, "/receive-vote", {
        "newBlockHash": newBlockHash,
        "newBlockIndex": newBlockIndex,
        "vote": vote,
        "nodeAddress": nodeIp
    });
}

app.post('/receive-vote', function (req, res) {
    isEndpointEnabled(req, res, () => {
        const blockHash = req.body.newBlockHash;
        const blockIndex = req.body.newBlockIndex;
        const vote = req.body.vote;
        log(`Vote ${vote} by ${req.body.nodeAddress} was received on block ${blockHash}`);
        votingStatistics.voteReceived(vote, req.body.nodeAddress);

        const results = blockchain.processVote(blockHash, blockIndex, req.body.nodeAddress, vote);

        if ('warning' in results) {
            log(results.warning);
            res.json({
                note: results.warning
            });
        } else {
            const closeConsensusTime = () => {
                votingStatistics.consensusFinished();
                log(`Consensus total time: ${votingStatistics.consensusTotalTime}ms`);
            };

            if (results.yesVotes >= getMinVotesRequired()) {
                blockchain.addBlockOnBuffer(blockHash);
                log(`Consensus was reached, new block (${blockHash}) added to the blockchain`);
                closeConsensusTime();
            } else if (results.totalVotes >= masterNodes.length + networkNodes.length) { // should never be greater, but just in case
                blockchain.closeVotingOnBlock(blockHash);
                log(`Consensus was NOT reached, new block (${blockHash}) was discarded`);
                closeConsensusTime();
            }

            res.json({
                note: `Vote on block ${req.body.newBlockHash} acknowledged by node ${nodeIp}`
            });
        }
    });
});

app.post('/validate', function (req, res) {
    isEndpointEnabled(req, res, () => {
        try {
            votingStatistics.validationStarted();
        } catch(err) {
            votingStatistics = new VotingStatistics();
        }

        if (!isValidMeta(req.body.originalBody)) {
            res.json({
                note: `Invalid car metadata`,
                vote: "no"
            });
        } else {
            log(`Starting validation on block ${req.body.createdBlock['hash']}`);
            log(`Block received from: ${req.connection.remoteAddress}`);
            // TODO: check if ip of sender matches any master node ip

            blockchain.putBlockOnHold(req.body.createdBlock);

            const newBlockHash = req.body.createdBlock['hash'];
            const newBlockIndex = req.body.createdBlock['index'];
            const validationResult = blockchain.isValidNewBlock(req.body.createdBlock);
            const isValidBlock = validationResult.isValid;

            if (!isValidBlock) {
                log(`block ${newBlockHash} is NOT valid, details as follows:`);
                log(validationResult.details);
            }

            const vote = isValidBlock ? "yes" : "no";

            votingStatistics.localValidationFinished();
            log(`Block validation time: ${votingStatistics.validationLocalTime}ms`);

            // broadcast vote to every node for validation
            const sendVotePromises = [];
            for (var i = 0; i < masterNodes.length; i++) {
                sendVotePromises.push(rp(makeVoteEmissionRequest(masterNodes[i], newBlockHash, newBlockIndex, vote)));
            }
            for (var i = 0; i < networkNodes.length; i++) {
                sendVotePromises.push(rp(makeVoteEmissionRequest(networkNodes[i], newBlockHash, newBlockIndex, vote)));
            }

            Promise.all(sendVotePromises)
                .then(function (body) {
                    log(`Vote transmission results:\n${JSON.stringify(body)}`);
                    votingStatistics.validationResultsReceived();
                    log(`Total validation time: ${votingStatistics.validationTotalTime}ms`);

                    res.json({
                        note: `Block ${newBlockHash} processed and vote ${vote} transmitted to the network`,
                        "nodeAddress": nodeIp
                    });

                });
        }
    });
});

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

function makeValidationRequest(networkNodeUrl, body, createdBlock) {
    return makePostRequest(networkNodeUrl, "/validate", {
        "originalBody": body,
        "createdBlock": createdBlock
    });
}

function checkTimestampFormat(timestamp) {
    // TODO: make this safer
    return (!!timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/));
}

function getCurrentTimestamp() {
    return (new Date()).toISOString().replace("T", " ").replace("Z", "");
}

app.post('/createBlock', function (req, res) {
    isEndpointEnabled(req, res, () => {
        log(`Received request to create block from ${req.connection.remoteAddress}`);
        votingStatistics = new VotingStatistics();

        if (!isMasterNode) {
            log(`This node (${nodeIp} ${nodeType}) has no permission to create blocks`);
            res.json({
                note: `This node (${nodeIp}) has no permission to create blocks. To create a new block send a request to a master node`
            });
        } else if (!isValidMeta(req.body)) {
            log(`Invalid request meta`);
            res.json({
                note: `Invalid request details`
            });
        } else {
            log(`Creating block for car ${req.body.carPlate} and broadcasting to network`);
            log(JSON.stringify(req.body));

            var timestamp;
            if ('timestamp' in req.body && checkTimestampFormat(req.body['timestamp'])) {
                timestamp = req.body['timestamp'];        // temporary measure to add data for testing, will be removed in the future
            } else {
                timestamp = getCurrentTimestamp();
            }

            log(`Timestamp used: ${timestamp}`);
            const createdBlock = blockchain.createBlock(blockchain.getLastBlock()['hash'], req.body.carPlate, req.body.block, timestamp);

            votingStatistics.blockCreationLocalFinished();
            log(`Block creation time: ${votingStatistics.blockCreationLocalTime}ms`);

            // broadcast block to every node for validation
            const validateNodesPromises = [];
            for (var i = 0; i < masterNodes.length; i++) {
                validateNodesPromises.push(rp(makeValidationRequest(masterNodes[i], req.body, createdBlock)));
            }
            for (var i = 0; i < networkNodes.length; i++) {
                validateNodesPromises.push(rp(makeValidationRequest(networkNodes[i], req.body, createdBlock)));
            }

            Promise.all(validateNodesPromises)
                .then((body) => {          // body is an array with the result of each request
                    log(`Block insertion results:\n${JSON.stringify(body)}`);
                    votingStatistics.blockCreationResultsReceived();
                    log(`Create block total time: ${votingStatistics.blockCreationTotalTime}ms`);

                    res.json({
                        note: `Block ${createdBlock['hash']} created and transmitted to the network for validation`,
                        block: createdBlock,
                        votingStatistics: votingStatistics.getResults(masterNodes.length + networkNodes.length)
                    });
                });
        }
    });
});

function makeRegisterRequest(networkNodeUrl, reqAddress, reqType) {
    return makePostRequest(networkNodeUrl, "/register-node", {
        nodeAddress: reqAddress,
        nodeType: reqType
    });
}

function isValidRegisterRequest(reqAddress, reqType) {
    const nodeNotAlreadyPresent = (networkNodes.indexOf(reqAddress) == -1) && (masterNodes.indexOf(reqAddress) == -1);
    const notCurrentNode = nodeIp != reqAddress;
    const validReqType = (reqType === "master") || (reqType === "network");
    return (nodeNotAlreadyPresent && notCurrentNode && validReqType && reqAddress && reqType);
}

app.post('/register-node', function (req, res) {
    isEndpointEnabled(req, res, () => {
        log(`Received register request from ${req.connection.remoteAddress}`);
        const reqAddress = req.body.nodeAddress;
        const reqType = req.body.nodeType;

        if (!isValidRegisterRequest(reqAddress, reqType)) {
            log(`Register request from ${reqAddress} is invalid`);
            res.json({
                note: `Invalid request for registering node`
            });
        } else {
            reqType === "master" ? masterNodes.push(reqAddress) : networkNodes.push(reqAddress);
            log(`Node ${reqAddress} added to the ${reqType} list`);
            res.json({
                note: `Node registered successfully on node ${nodeUuid}, ${nodeIp}`
            });
        }
    });
});

app.post('/deregister-node', (req, res) => {
    isEndpointEnabled(req, res, () => {
        log(`Received deregister request from ${req.connection.remoteAddress}`);
        const nodeAddress = req.body.nodeAddress
        // TODO: check if node has permission to deregister nodeAddress
        var index = masterNodes.indexOf(nodeAddress);
        if (index > -1) {
            const removed = masterNodes.splice(index, 1);
            res.json({node: `${removed} removed from network`});
        }
        var index = networkNodes.indexOf(nodeAddress);
        if (index > -1) {
            const removed = networkNodes.splice(index, 1);
            res.json({node: `${removed} removed from network`});
        }

        res.status(404).json({note: `${nodeAddress} not found in network`});
    });
});

function removeFromNetwork(nodeIp, callback) {
    const body = {nodeAddress: nodeIp};
    const unregNodesPromises = [];
    for (var i = 0; i < masterNodes.length; i++) {
        unregNodesPromises.push(rp(makePostRequest(masterNodes[i], '/deregister-node', body)));
    }
    for (var i = 0; i < networkNodes.length; i++) {
        unregNodesPromises.push(rp(makePostRequest(networkNodes[i], '/deregister-node', body)));
    }

    log(`Removind node ${nodeIp} from network`);
    Promise
        .all(unregNodesPromises)
        .then(() => {
            log(`Node ${nodeIp} removed from network`)
            callback();
        }).catch((err) => {
            log(`Error removing node from network`);
            log(err);
        });
}

function removeSelfFromNetwork(callback) {
    removeFromNetwork(nodeIp, callback);
}

app.post('/deregister-self', (req, res) => {
    removeSelfFromNetwork(() => {
        res.json({note: `${nodeIp} deregistered from network`});
    });
});

app.post('/register-and-broadcast-node', function (req, res) {
    isEndpointEnabled(req, res, () => {
        log(`Received request from ${req.connection.remoteAddress} to join network`);
        log(JSON.stringify(req.body));
        const reqType = req.body.nodeType;
        const reqAddress = req.body.nodeIp;
        
        const regNodesPromises = [];
        for (var i = 0; i < masterNodes.length; i++) {
            regNodesPromises.push(rp(makeRegisterRequest(masterNodes[i], reqAddress, reqType)));
        }
        for (var i = 0; i < networkNodes.length; i++) {
            regNodesPromises.push(rp(makeRegisterRequest(networkNodes[i], reqAddress, reqType)));
        }

        log(`Broadcasting node ${reqAddress} (${reqType}) to network`);
        Promise
            .all(regNodesPromises)
            .then(() => {
                log(`Node ${reqAddress} added to network`)
                res.json(getNodesStatus())
            }).catch((err) => {
                log(`Error broadcasting new node to network`);
                log(err);
            });
    });
});

app.post('/start-register', function (req, res) {
    isEndpointEnabled(req, res, () => {
        const reqBcType = req.body.blockchainType;

        log(`Starting node registration of type '${reqBcType}' for ${req.connection.remoteAddress}`);
        res.json({
            data: reqBcType === "full" ? getURI(nodeIp, "/blockchain/0") : getLastBlocks(10)
        });
    });
});

function isValidMasterNode(nodeAddress) {
    // TODO validate master node address on enterprise website
    return (!!nodeAddress);
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
        blockchain.chain = blockchain.chain.concat(body['chain']);
        
        if (body["nextUrl"] !== "none") { 
            fullUpdateBlockchain(body["nextUrl"], callback); 
        } 
        else { 
            callback();
        }
    })
}

function requestRegister(ip, nodeType, nodeIp) {
    request.post({
        url: getURI(ip, '/register-and-broadcast-node'),
        form: { nodeType, nodeIp }
    }, function (err, res, body) {
        log(`Received response for register request`);
        log(body);
        body = JSON.parse(body);

        if (!body['masterNodes'].length) {      // there should be at least 1 master node in the network
            throw `Could not retrieve nodes from ${masterAddress}`;
        }
        
        masterNodes = body['masterNodes'];
        networkNodes = body['networkNodes'];
        isBlockchainAvailable = true;
    })
}

if (masterAddress === 'this'){
    if (!isMasterNode) {
        throw `A common network node cannot be a master node, node type: ${nodeType}`;
    } else {
        masterNodes.push(nodeIp);
        isBlockchainAvailable = true;
    }
} else {
    if (!isValidMasterNode(masterAddress)) {
        throw `Master node address invalid: ${masterAddress}`;
    }

    // TODO: request master nodes from company's API

    log(`Requesting registration to master node ${masterAddress}`);
    request.post({
        url: getURI(masterAddress, "/start-register"), 
        form: { blockchainType }
    }, function (err, res, body) {
        log(`Response received, adding network nodes`);
        log(body);
        body = JSON.parse(body);

        if (blockchainType === "full") {
            blockchain.chain = [];
            fullUpdateBlockchain(body['data'], () => {
                requestRegister(masterAddress, nodeType, nodeIp);
            })
        } else if (blockchainType === "light") {
            blockchain.chain = body['data'];
            requestRegister(masterAddress, nodeType, nodeIp);
        } else {
            // TODO unregister from network
        }
    });
}

app.listen(PORT, function () {
    log(`Listening on port ${PORT}...`);
});

// TODO: when a node goes offline, warn others to be removed from nodes list
