import db from './db'

const io = require('socket.io-client')
const config = require("./config");
//const stash = require('stash')('/')
const worker = require('./worker')

// Holdover until real userid can be set

export class Dataflow {
    constructor() {
        this.worker = new Worker({dataflow: this, db});
        this.initStorage();
        this.connect();
    }

    initStorage() {
        this.db = db;
    }

    connect() {

        let userid = 'asdfg1234' //stash.get('userid');
        if (!userid) {
            console.error("User not logged in!")
            return;
        }

        if (this.socket) return this.socket;

        const socket = this.socket = io(config.url + '/user/' + userid);


        this.registerListeners();

        socket.open()
    }

    async updateHistory() {
        console.log(db);
        let lastMessage = await db.message.schema.mappedClass.getLastMessage();
        let lastDate = lastMessage && lastMessage[0] ? lastMessage[0].date : false;

        this.socket.emit('messageHistoryRequest', {lastDate});
    }

    registerListeners() {

        let socket = this.connect();

        // Called whenever a new server connection is made
        socket.on('helloClient', (serverData) => {
            console.log(serverData);
            socket.emit('helloServer', this.getClientInfo());
            this.updateHistory();
        });


        // Called whenever a new client (or worker) connects to this message namespace
        socket.on('newClient', ({role, deviceName}) => {
            console.log(`New ${role}: ${deviceName} is on this message queue`);
        });

        socket.on('sendMessage', this.onSendMessage.bind(this));
        socket.on('messageSent', this.onMessageSent.bind(this));
        socket.on('receivedMessage', this.onReceivedMessage.bind(this));
        socket.on('messageHistory', this.onMessageHistory.bind(this));
        socket.on('messageHistoryRequest', this.onMessageHistoryRequest.bind(this));

    }

    /**
     * Gives us an inventory of locally known data for sharing to other nodes
     */
    getClientInfo() {

        // Discover who we are
        let clientInfo = {};

        // Is this an electron app or no?
        if (window.require) {
            let os = window.require('os');
            clientInfo = {
                deviceName: os.hostname(),
                os: {
                    arch: os.arch(),
                    platform: os.platform(),
                    version: os.version()
                },

            }

        } else {
            clientInfo = {
                deviceName: false,//store.get('deviceName'),
                os: {
                    platform: navigator.userAgent,
                    version: navigator.appName
                }
            }
        }
        if (!clientInfo.deviceName) {
            clientInfo.deviceName = "browser-" + (new Date()).getTime();
            //store.set('deviceName', clientInfo.deviceName)
        }

        clientInfo.role = 'client';

        return clientInfo;
    }


    /**
     * This is when a message is sent from another ayeMesage device, to be sent by Messages
     *
     * @param chat_identifier {string}  The unique identifier for this chat session
     * @param text            {string}  The body of the message to be sent
     * @param attachments     {[{}]}    Any attachments to include (currently unsupported)
     * @param tracking_id     {string}  A unique ID assigned to this message, for tracking within ayeMessage until finally sent and given it's final ID/GUID
     */
    async onSendMessage({chat_identifier, text, attachments, tracking_id}) {
        let result = false;
        try {
            result = await this.worker.sendMessage(arguments[0]);
        } catch (e) {
            console.error(e);
        }
        this.socket.emit('messageSent', {tracking_id, result});
        this.onMessageSent({tracking_id, result});
    }

    /**
     * This is when a message, originating from ayeMessage, is confirmed to be sent by Messages - note that this does NOT give us
     * the final message object, only that this has been sent successfully to the end Messages application.
     *
     * @param tracking_id     {string}  The unique internally tracked ID of the message sent
     * @param result          {boolean} Whether the message sent successfully or not
     */
    onMessageSent({tracking_id, result}) {
        // @TODO: check result, if failed, failures, etc.
        // @TODO: if message was sent from this device, if not populate here
    }

    /**
     * This is when a new message appears inside of iMessage (whether sent by me, in ayeMessage, or received from another person)
     *
     * @param message       {Message}   The message data, used to create the object
     * @param chat          {Chat}      When applicable, the chat data used to create the new record
     * @param backloading   {boolean}   Whether we are backloading data, or this is a new message, in which case we should notify
     * @returns Promise<{[Chat|Message]}>
     */
    async onReceivedMessage({message, chat}, backloading) {
        let promises = [];
        if (chat) {
            promises.push(db.chat.add(chat));
        }

        if (message) {
            promises.push(db.message.add(message));
        }

        let result = await Promise.all(promises);

        if (!backloading) {
            // @TODO: Notify application and user
        }

        return result;
    }

    /**
     * Received when message history data is received, normally at our request
     *
     * @param chats        {[Chat]}     An array of chats to backload
     * @param messages     {[Message]}  An array of messages to backload
     * @returns Promise<void>
     */
    async onMessageHistory({chats, messages}) {
        let promises = [];
        if (chats && chats.length) {
            promises.push(db.chat.bulkAdd(chats));
        }
        if (messages && messages.length) {
            promises.push(db.message.bulkAdd(messages));
        }
        await Promise.all(promises);
    }

    /**
     * Sent when another device is requesting message logs.  We should listen for a specific flag, because other
     * devices may request logs from the Worker OR from other clients depending on whether it can get ahold of the Worker or not
     *
     * @param allowPeers    {boolean}  Whether to allow peer provided data history, typically when worker is offline
     * @param lastDate      {integer}  Timestamp of last message received
     */
    async onMessageHistoryRequest({allowPeers, lastDate}) {
        let history = await this.worker.getMessageHistory({lastDate})

        this.socket.emit('messageHistory', history);
        this.onMessageHistory(history);
    }


}

let dataflow = new Dataflow();
export default dataflow;