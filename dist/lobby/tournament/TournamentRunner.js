"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
exports.__esModule = true;
var uuid = require("uuid/v4");
var PubSub_1 = require("../../lib/PubSub");
var events_1 = require("../../socket/events");
var MatchRunner_1 = require("./match/MatchRunner");
var DoubleEliminationMatchmaker_1 = require("./matchmaker/DoubleEliminationMatchmaker");
var FreeForAllMatchmaker_1 = require("./matchmaker/FreeForAllMatchmaker");
var TournamentRunner = (function () {
    function TournamentRunner(options, players, lobby) {
        var _this = this;
        this.matches = [];
        this.getTournament = function () {
            return __assign({ matches: _this.matches }, _this.tournament);
        };
        this.start = function () {
            if (_this.tournament.started) {
                console.log("Tournament already started, not starting", _this.getTournament());
                return;
            }
            _this.tournament.started = true;
            var matchOptions = {
                autoPlay: _this.tournament.options.autoPlay,
                maxGames: _this.tournament.options.numberOfGames,
                timeout: _this.tournament.options.timeout
            };
            switch (_this.tournament.options.type) {
                case "DoubleElimination":
                    _this.matchmaker = new DoubleEliminationMatchmaker_1["default"](_this.tournament.players, matchOptions);
                    break;
                case "FreeForAll":
                default:
                    _this.matchmaker = new FreeForAllMatchmaker_1["default"](_this.tournament.players, matchOptions);
                    break;
            }
            _this.matches = _this.matchmaker.getRemainingMatches();
            _this.pubSub.publish(events_1.EVENTS.BROADCAST_NAMESPACED, {
                event: events_1.EVENTS.LOBBY_TOURNAMENT_STARTED,
                namespace: _this.tournament.lobby,
                payload: {
                    tournament: _this.getTournament()
                }
            });
        };
        this["continue"] = function () {
            _this.playNextMatch();
        };
        this.onTournamentEnd = function () {
            _this.tournament.finished = true;
            _this.tournament.waiting = false;
            _this.matchmaker.updateStats(_this.matches, true);
            _this.sendStats();
        };
        this.playNextMatch = function () {
            var _a;
            _this.matchmaker.updateStats(_this.matches);
            _this.tournament.waiting = false;
            _this.tournament.ranking = _this.matchmaker.getRanking();
            if (_this.matchmaker.isFinished()) {
                _this.onTournamentEnd();
            }
            _this.sendStats();
            var upcomingMatches = _this.matches.filter(function (match) { return match.state === "upcoming"; });
            if (upcomingMatches.length < 1) {
                (_a = _this.matches).push.apply(_a, _this.matchmaker.getRemainingMatches());
                _this.playNextMatch();
                return;
            }
            var nextMatch = upcomingMatches[0];
            var matchRunner = new MatchRunner_1.MatchRunner(nextMatch, _this.tournament.tournamentID);
            matchRunner.start();
        };
        this.sendStats = function () {
            _this.pubSub.publish(events_1.EVENTS.BROADCAST_NAMESPACED, {
                event: events_1.EVENTS.TOURNAMENT_STATS,
                namespace: _this.tournament.lobby,
                payload: __assign({}, _this.getTournament())
            });
        };
        this.tournament = {
            finished: false,
            lobby: lobby,
            options: options,
            players: players,
            ranking: [],
            started: false,
            tournamentID: uuid(),
            waiting: !options.autoPlay
        };
        this.pubSub = new PubSub_1["default"]();
        this.pubSub.subscribeNamespaced(this.tournament.tournamentID, events_1.EVENTS.MATCH_ENDED, this.playNextMatch);
        this.pubSub.subscribeNamespaced(this.tournament.tournamentID, events_1.EVENTS.MATCH_UPDATE, this.sendStats);
    }
    return TournamentRunner;
}());
exports.TournamentRunner = TournamentRunner;
//# sourceMappingURL=TournamentRunner.js.map