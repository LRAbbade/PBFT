const uuid = require('uuid/v1');
const sha256 = require('sha256');

function Blockchain() {
    this.chain = [];
    this.buffer = {};       // holds information about blocks on voting proccess

    const genesisBlock = this.createBlock("CarChainGenesisBlock", "-", {
        data: "I am the genesis block!",
        authors: "Alisson Morais, Filipe Mazzon, Lucas Abbade e Matheus Silva"
    });
    this.chain.push(genesisBlock);
}

Blockchain.prototype.updateInstance = function(blockchain) {
    this.chain = blockchain.chain;
    this.onHold = blockchain.onHold;
    this.voting = blockchain.voting;
}

Blockchain.prototype.getLastBlock = function() {
    return this.chain[this.chain.length - 1];
}

Blockchain.prototype.getLasts = function(range) {
    if (this.chain.length < range) range = this.chain.length
    const start = this.chain.length - range
    const end = this.chain.length

    return this.chain.slice(start, end)
}

Blockchain.prototype.getBlockHash = function(previousBlockHash, carPlate, carData) {
    const dataAsString = previousBlockHash + JSON.stringify(carPlate) + JSON.stringify(carData);
    return sha256(dataAsString);
}

Blockchain.prototype.createBlock = function(lastBlockHash, carPlate, carData, timestamp) {
    var index = 1;
    try { 
        index = this.chain[this.chain.length - 1].index + 1;
    } catch(err) { 
        index = 1;
    }

    return {
        index: index,
        id: uuid(),
        timestamp: timestamp,
        carPlate: carPlate,
        carData: carData,
        hash: this.getBlockHash(lastBlockHash, carPlate, carData),
        previousBlockHash: lastBlockHash
    };
}

Blockchain.prototype.putBlockOnHold = function(block) {
    if (!block['hash'] in this.buffer) {
        this.buffer[block['hash']] = {
            block: block,
            voting: {
                nodesVoted: [],
                votes: [],
                yesVotes: 0
            }
        }
    }

    console.log(`Current buffer:`);
    console.log(this.buffer);
}

// TODO: this might blow up if node is not a full node
// test if there's a possibility of the array index being different than 'index-1'
Blockchain.prototype.isBlockInBlockchain = function(hash, index) {
    return (this.chain[index-2]['hash'] === hash);
}

// returns current number of yes votes for block on voting after new vote is processed
Blockchain.prototype.processVote = function(blockHash, blockIndex, nodeAddress, vote) {
    if (this.isBlockInBlockchain(blockHash, blockIndex)) {              // this block was already accepted (can happen if a vote comes after consensus was already achieved)
        console.log(`Block ${blockHash} already accepted. Index: ${blockIndex}`);
        return -1;
    }

    // check if block being voted is in buffer and vote is not repeated
    if (blockHash in this.buffer) {
        if (this.buffer[blockHash].voting.nodesVoted.indexOf(nodeAddress) == -1) {
            this.buffer[blockHash].voting.nodesVoted.push(nodeAddress);
            this.buffer[blockHash].voting.votes.push({
                node: nodeAddress,
                vote: vote
            });
            if (vote === "yes") this.buffer[blockHash].voting.yesVotes++;
        }
    } else {
        // TODO: a vote might be received before the block was put on buffer
    }

    return { 
        totalVotes: this.buffer[blockHash].voting.nodesVoted.length,
        yesVotes: this.buffer[blockHash].voting.yesVotes
    };
}

Blockchain.prototype.addBlockOnBuffer = function(hash) {
    if (!hash in this.buffer) {
        throw `Trying to add block that is not on buffer: ${hash}`;
    }

    this.chain.push(this.buffer[hash].block);
    delete this.buffer[hash];

    console.log(`Current buffer:`);
    console.log(this.buffer);
}

Blockchain.prototype.discardBlockOnBuffer = function(hash) {
    delete this.buffer[hash];
    
    console.log(`Current buffer:`);
    console.log(this.buffer);
}

Blockchain.prototype.isValidNewBlock = function(newBlock) {
    const lastBlock = this.getLastBlock();
    const correctIndex = newBlock['index'] === lastBlock['index'] + 1;
    const correctLastHash = newBlock['previousBlockHash'] === lastBlock['hash'];
    const recalculatedNewHash = this.getBlockHash(newBlock['previousBlockHash'], newBlock['carPlate'], newBlock['carData']);
    const correctNewHash = recalculatedNewHash === newBlock['hash'];

    return {
        details: {
            "correctIndex": correctIndex,
            "correctLastHash": correctLastHash,
            "correctNewHash": correctNewHash
        },
        isValid: (correctIndex && correctLastHash && correctNewHash)
    };
}

module.exports = Blockchain