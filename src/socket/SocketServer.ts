// tslint:disable-next-line:no-var-requires
const debug = require("debug")("sg:socketServer");

import { EventName, LegacyEvents, Messages, Player } from "@socialgorithm/model";
import * as fs from "fs";
import * as http from "http";
import { Server, Socket } from "socket.io";
import { GameServerInfoConnection } from "../game-server/GameServerInfoConnection";
import { Events as PubSubEvents } from "../pub-sub";
import PubSub from "../pub-sub/PubSub";

export class SocketServer {
  private io: Server;
  private pubSub: PubSub;
  private playerSockets: {
    [key: string]: Socket,
  } = {};

  constructor(private server: http.Server, private gameServers: GameServerInfoConnection[]) {
    this.pubSub = new PubSub();
  }

  public start() {
    this.io = new Server(this.server, { cors: { origin: "*", methods: ["GET", "POST"] }});

    this.io.use((socket: Socket, next: any) => {
      const isClient = socket.handshake.query.client || false;
      if (isClient) {
        return next();
      }
      const { token } = socket.handshake.query;
      if (!token) {
        return next(new Error("Missing token"));
      }
      next();
    });

    this.io.on("connection", (socket: Socket) => {
      const token = socket.handshake.query.token as string;
      const player = token;

      if (this.playerSockets[player]) {
        // Token already in use - disallow the new socket
        debug("Player already connected %s", player);
        socket.emit("exception", { error: "Token/name already in use, please pick another" });
        socket.disconnect(true);
        return false;
      }

      debug("Connected %s", player);

      // Store the socket
      this.playerSockets[player] = socket;

      // Forward the socket events to the PubSub system
      const listenToEvents = [
        LegacyEvents.EVENTS.LOBBY_CREATE,
        LegacyEvents.EVENTS.LOBBY_TOURNAMENT_START,
        LegacyEvents.EVENTS.LOBBY_TOURNAMENT_CONTINUE,
        LegacyEvents.EVENTS.LOBBY_JOIN,
        LegacyEvents.EVENTS.LOBBY_PLAYER_BAN,
        LegacyEvents.EVENTS.LOBBY_PLAYER_KICK,
      ];
      listenToEvents.forEach(event => {
        socket.on(event, this.onMessageFromSocket(player, event));
      });

      socket.on("disconnect", this.onPlayerDisconnect(player));
    });

    // Senders
    this.pubSub.subscribe(PubSubEvents.ServerToPlayer, this.sendMessageToPlayer);
    this.pubSub.subscribe(PubSubEvents.BroadcastNamespaced, this.sendMessageToNamespace);
    this.pubSub.subscribe(PubSubEvents.AddPlayerToNamespace, this.addPlayerToNamespace);
    this.pubSub.subscribe(PubSubEvents.GameList, this.sendGameListToEveryone);
  }

  private addPlayerToNamespace = (data: Messages.ADD_PLAYER_TO_NAMESPACE_MESSAGE) => {
    if (!this.playerSockets[data.player]) {
      debug("Error adding player (%s) to namespace, player socket does not exist", data.player);
      return;
    }
    this.playerSockets[data.player].join(data.namespace);

    // Send Game List
    this.playerSockets[data.player].emit(EventName.GameList, this.gameServers.map(server => server.status));
  }

  private sendMessageToNamespace = (data: Messages.BROADCAST_NAMESPACED_MESSAGE) => {
    this.io.in(data.namespace).emit(data.event, data.payload);
  }

  private sendMessageToPlayer = (data: Messages.SERVER_TO_PLAYER_MESSAGE) => {
    const socket = this.playerSockets[data.player];

    if (!socket) {
      debug("Error sending message to player (%s), player socket does not exist", data.player);
      return;
    }
    socket.emit(data.event, data.payload);
  }

  private sendGameListToEveryone = (data: Messages.GameServerStatus[]) => {
    debug("Game server list updated, publishing update: %O", data);
    Object.values(this.playerSockets).forEach(socket => {
      socket.emit(EventName.GameList, data);
    });
  }

  /**
   * Generic event forwarder from the socket to the pubsub bus
   */
  private onMessageFromSocket = (player: Player, event: LegacyEvents.EVENTS) => (payload: any) => {
    const data: any = {
      payload,
      player,
    };
    this.pubSub.publish(this.translateSocketMessageToPubSub(event), data);
  }

  private translateSocketMessageToPubSub(socketEvent: LegacyEvents.EVENTS): PubSubEvents {
    switch (socketEvent) {
      case LegacyEvents.EVENTS.LOBBY_CREATE:
        return PubSubEvents.LobbyCreate;
      case LegacyEvents.EVENTS.LOBBY_TOURNAMENT_START:
        return PubSubEvents.LobbyTournamentStart;
      case LegacyEvents.EVENTS.LOBBY_TOURNAMENT_CONTINUE:
        return PubSubEvents.LobbyTournamentContinue;
      case LegacyEvents.EVENTS.LOBBY_JOIN:
        return PubSubEvents.LobbyJoin;
      case LegacyEvents.EVENTS.LOBBY_PLAYER_BAN:
        return PubSubEvents.LobbyPlayerBan;
      case LegacyEvents.EVENTS.LOBBY_PLAYER_KICK:
        return PubSubEvents.LobbyPlayerKick;
    }
  }

  private onPlayerDisconnect = (player: Player) => () => {
    debug("Removing player (%s) from server", player);
    delete this.playerSockets[player];
    this.pubSub.publish(PubSubEvents.PlayerDisconnected, { player });
  }

  /**
   * Handler for the WebSocket server. It returns a static HTML file for any request
   * that links to the server documentation and Github page.
   * @param req
   * @param res
   */
  private handler(req: http.IncomingMessage, res: http.ServerResponse) {
    fs.readFile(__dirname + "/../../public/index.html",
      (err: any, data: any) => {
        if (err) {
          res.writeHead(500);
          return res.end("Error loading index.html");
        }

        res.writeHead(200);
        res.end(data);
      });
  }
}
