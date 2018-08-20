const uuid = require('uuid/v1');
const sha256 = require('sha256');

function Blockchain() {
    this.chain = [];
    this.onHold = null;

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

Blockchain.prototype.createBlock = function(previousBlockHash, carPlate, carData) {
    return {
        index: this.chain.length + 1,
        timestamp: Date(Date.now()).split(' ').slice(0, 5).join(' '),
        carPlate: carPlate,
        carData: carData,
        hash: this.getBlockHash(previousBlockHash, carPlate + carData),
        previousBlockHash: previousBlockHash
    };
}

Blockchain.prototype.addBlockOnHold = function() {
    if (!this.onHold) {
        throw `Invalid block on hold: ${this.onHold}`;
    }

    this.chain.push(this.onHold);
    this.onHold = null;
}

Blockchain.prototype.discardBlockOnHold = function() {
    this.onHold = null;
}

Blockchain.prototype.isValidNewBlock = function(newBlock) {
    const lastBlock = this.getLastBlock();
    const correctIndex = newBlock['index'] === lastBlock['index'] + 1;
    const correctLastHash = newBlock['previousBlockHash'] ===  lastBlock['hash'];
    const recalculatedNewHash = this.getBlockHash(newBlock['previousBlockHash'], newBlock['carPlate'] + newBlock['carData']);
    const correctNewHash = recalculatedNewHash === newBlock['hash'];

    return (correctIndex && correctLastHash && correctNewHash);
}

module.exports = Blockchain