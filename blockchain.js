const uuid = require('uuid/v1');
const sha256 = require('sha256');

function Blockchain() {
    this.chain = [];
    this.onHold = null;
    this.voting = null;     // information about the voting on the 'onHold' block

    const genesisBlock = this.createBlock("CarChainGenesisBlock", "-", {
        data: "I am the genesis block!",
        authors: "Alisson Moraes, Filipe Mazzon, Lucas Abbade e Matheus Silva"
    });
    this.chain.push(genesisBlock);
}

Blockchain.prototype.getLastBlock = function() {
    return this.chain[this.chain.length - 1];
};

Blockchain.prototype.getBlockHash = function(previousBlockHash, carData) {
    const dataAsString = previousBlockHash + JSON.stringify(carData);
    return sha256(dataAsString);
}

Blockchain.prototype.createBlock = function(lastBlockHash, carPlate, carData) {
    return {
        index: this.chain.length + 1,
        timestamp: Date(Date.now()).split(' ').slice(0, 5).join(' '),
        carPlate: carPlate,
        carData: carData,
        hash: this.getBlockHash(lastBlockHash, carPlate + carData),
        previousBlockHash: lastBlockHash
    };
}

// TODO: add tolerance for when multiple new blocks are requested at the same time
Blockchain.prototype.putBlockOnHold = function(block) {
    this.onHold = block;
    this.voting = {
        nodesVoted: [],
        votes: [],
        yesVotes: 0
    };
}

// returns current number of yes votes for 'onHold' block after new vote is processed
Blockchain.prototype.processVote = function(blockHash, nodeAddress, vote) {
    if (blockHash === this.getLastBlock()['hash']) return -1;   // this block was already accepted (can happen if a vote comes after consensus was already achieved)

    // TODO: a vote might be received before the block was put on hold, this will crash the if below

    // check if block being voted is the same as 'onHold' and vote is not repeated
    if (blockHash === this.onHold['hash']) {
        if (this.voting.nodesVoted.indexOf(nodeAddress) == -1) {
            this.voting.nodesVoted.push(nodeAddress);
            this.voting.votes.push({
                node: nodeAddress,
                vote: vote
            });
            if (vote === "yes") this.voting.yesVotes++;
        }
    } else {
        // TODO: if block is different from 'onHold', something must be wrong
    }

    return { 
        totalVotes: this.voting.nodesVoted.length,
        yesVotes: this.voting.yesVotes
    };
}

Blockchain.prototype.addBlockOnHold = function() {
    if (!this.onHold) {
        throw `Invalid block on hold: ${this.onHold}`;
    }

    this.chain.push(this.onHold);
    this.onHold = null;
    this.voting = null;
}

Blockchain.prototype.discardBlockOnHold = function() {
    this.onHold = null;
    this.voting = null;
}

Blockchain.prototype.isValidNewBlock = function(newBlock) {
    const lastBlock = this.getLastBlock();
    const correctIndex = newBlock['index'] === lastBlock['index'] + 1;
    const correctLastHash = newBlock['previousBlockHash'] === lastBlock['hash'];
    const recalculatedNewHash = this.getBlockHash(newBlock['previousBlockHash'], newBlock['carPlate'] + newBlock['carData']);
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