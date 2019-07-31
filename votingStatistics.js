class VotingStatistics {
    constructor() {
        this.startedCreationTimestamp = new Date();
        this.votes = [];
    }

    blockCreationLocalFinished() {
        const timestamp = new Date();
        this.localBlockCreationFinishedTimestamp = timestamp;
        this.blockCreationLocalTime = timestamp - this.startedCreationTimestamp;
        this.startedConsensusTimestamp = timestamp;
    }

    blockCreationResultsReceived() {
        const timestamp = new Date();
        this.resultsReceivedTimestamp = timestamp;
        this.blockCreationTotalTime = timestamp - this.startedCreationTimestamp;
    }

    validationStarted() {
        this.validationStartedTimestamp = new Date();
    }

    localValidationFinished() {
        const timestamp = new Date();
        this.localValidationFinishedTimestamp = timestamp;
        this.validationLocalTime = timestamp - this.validationStartedTimestamp;
    }

    validationResultsReceived() {
        const timestamp = new Date();
        this.validationFinishedTimestamp = timestamp;
        this.validationTotalTime = timestamp - this.validationStartedTimestamp;
    }

    consensusFinished() {
        const timestamp = new Date();
        this.consensusFinishTimestamp = timestamp;
        this.consensusTotalTime = timestamp - this.startedConsensusTimestamp;
    }

    voteReceived(vote, node) {
        this.votes.push({
            'timestamp': new Date(),
            node,
            vote
        });
    }

    getResults(numOfNodes) {
        return {
            'blockCreationLocalTime': this.blockCreationLocalTime,
            'validationLocalTime': this.validationLocalTime,
            'validationTotalTime': this.validationTotalTime,
            'consensusTotalTime': this.consensusTotalTime,
            'blockCreationTotalTime': this.blockCreationTotalTime,
            'timeScale': 'ms',
            'numberOfNodesInNetwork': numOfNodes,
            'detailedTimestamps': {
                'startedCreationTimestamp': prettyTimestamp(this.startedCreationTimestamp),
                'localBlockCreationFinishedTimestamp': prettyTimestamp(this.localBlockCreationFinishedTimestamp),
                'startedConsensusTimestamp': prettyTimestamp(this.startedConsensusTimestamp),
                'validationStartedTimestamp': prettyTimestamp(this.validationStartedTimestamp),
                'localValidationFinishedTimestamp': prettyTimestamp(this.localValidationFinishedTimestamp),
                'consensusFinishTimestamp': prettyTimestamp(this.consensusFinishTimestamp),
                'validationFinishedTimestamp': prettyTimestamp(this.validationFinishedTimestamp),
                'resultsReceivedTimestamp': prettyTimestamp(this.resultsReceivedTimestamp),
                'receivedVotesTimestamps': this.votes
            }
        }
    }
}

function prettyTimestamp(ts) {
    return ts.toISOString().replace('T', ' ').replace('Z', '');
}

module.exports = VotingStatistics
