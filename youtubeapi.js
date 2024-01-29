module.exports = class {

	/**
     * **Créer une instance de l'api**
     * --- --- --
     * @param {{apiKey:string}} config
     * > * `apiKey`: Votre clé api fournie par google
     *--- --- ---
     * **Pour générer une clé api**:
     * > > - Rendez-vous sur votre [console google](console.cloud.google.com/welcome)
     * > > - Créez un nouveau projet
     * > > - Puis générez une nouvelle clé dans "API et services" -> "Identifiants" -> "Créer des identifiants" -> "Clé API"
     */
	constructor(config) {

		this.apiKey = config.apiKey;

		/**
         * @param {string} username
         * @returns {Promise<{
         * ok:boolean,
         * status:number,
         * statusText:string,
         * data?:{
         * kind:string,
         * etag:string,
         * id:string,
         * snippet:{
         * title:string,
         * description:string,
         * customUrl:string,
         * publishedAt:string,
         * thumbnails:{
         * default:{
         * url:string,
         * width:number,
         * height:number
         * },
         * medium?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * high?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * standard?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * maxres?:{
         * url:string,
         * width:number,
         * height:number
         * }
         * },
         * localized:{
         * title:string,
         * description:string
         * },
         * country:string,
         * contentDetails:{
         * likes:string,
         * uploads:string
         * },
         * statistics:{
         * viewCount:string,
         * subscriberCount:string,
         * hiddenSubscriberCount:boolean,
         * videoCount:string
         * }
         * }
         * }
         * }>}
         */
		this.getChannelByUsername = async (username) => {

			const response = await fetch(`https://youtube.googleapis.com/youtube/v3/channels?part=snippet%2CcontentDetails%2Cstatistics&forUsername=${username}&key=${this.apiKey}`);

			if (response.ok) {
				const data = await response.json();
				return { ok:response.ok, status:response.status, statusText:response.statusText, data:data.items ? data.items[0] : {} };
			}
			else {
				return { ok:response.ok, status:response.status, statusText:response.statusText };
			}

		};

		/**
         * @param {string} username
         * @returns {Promise<{
         * ok:boolean,
         * status:number,
         * statusText:string,
         * data?:{
         * kind:string,
         * etag:string,
         * id:string,
         * snippet:{
         * title:string,
         * description:string,
         * customUrl:string,
         * publishedAt:string,
         * thumbnails:{
         * default:{
         * url:string,
         * width:number,
         * height:number
         * },
         * medium?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * high?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * standard?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * maxres?:{
         * url:string,
         * width:number,
         * height:number
         * }
         * },
         * localized:{
         * title:string,
         * description:string
         * },
         * country:string,
         * contentDetails:{
         * likes:string,
         * uploads:string
         * },
         * statistics:{
         * viewCount:string,
         * subscriberCount:string,
         * hiddenSubscriberCount:boolean,
         * videoCount:string
         * }
         * }
         * }
         * }>}
         */
		this.getChannelById = async (id) => {

			const response = await fetch(`https://youtube.googleapis.com/youtube/v3/channels?part=snippet%2CcontentDetails%2Cstatistics&id=${id}&key=${this.apiKey}`);

			if (response.ok) {
				const data = await response.json();
				return { ok:response.ok, status:response.status, statusText:response.statusText, data:data.items ? data.items[0] : {} };
			}
			else {
				return { ok:response.ok, status:response.status, statusText:response.statusText };
			}

		};

		/**
         * @param {string} username
         * @returns {Promise<{
         * ok:boolean,
         * status:number,
         * statusText:string,
         * data?:{
         * publishedAt:string,
         * channelId:string,
         * title:string,
         * description:string,
         * thumbnails:{
         * default:{
         * url:string,
         * width:number,
         * height:number
         * },
         * medium?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * high?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * standard?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * maxres?:{
         * url:string,
         * width:number,
         * height:number
         * }
         * },
         * channelTitle:string,
         * playlistId:string,
         * position:number,
         * resourceId:{
         * kind:string,
         * videoId:string
         * },
         * videoOwnerChannelTitle:string,
         * videoOwnerChannelId:string
         * }
         * }>}
         */
		this.getLastVideoByUsername = async (username) => {

			const channel = await this.GET.channelByUsername(username);

			if (channel.ok) {

				if (!channel.data.contentDetails) {
					return { ok:response.ok, status:response.status, statusText:response.statusText, data:{} };
				}

				const relatedUploads = channel.data.contentDetails.relatedPlaylists.uploads;
				const response = await fetch(`https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${relatedUploads}&order=date&maxResults=1&key=${this.apiKey}`);

				if (response.ok) {
					const data = await response.json();
					return { ok:response.ok, status:response.status, statusText:response.statusText, data:data.items ? data.items[0].snippet : {} };
				}
				else {
					return { ok:response.ok, status:response.status, statusText:response.statusText, data:{} };
				}

			}
			else {
				return { ok:channel.ok, status:channel.status, statusText:channel.statusText };
			}
		};

		/**
         * @param {string} id
         * @returns {Promise<{
         * ok:boolean,
         * status:number,
         * statusText:string,
         * data?:{
         * publishedAt:string,
         * channelId:string,
         * title:string,
         * description:string,
         * thumbnails:{
         * default:{
         * url:string,
         * width:number,
         * height:number
         * },
         * medium?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * high?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * standard?:{
         * url:string,
         * width:number,
         * height:number
         * },
         * maxres?:{
         * url:string,
         * width:number,
         * height:number
         * }
         * },
         * channelTitle:string,
         * playlistId:string,
         * position:number,
         * resourceId:{
         * kind:string,
         * videoId:string
         * },
         * videoOwnerChannelTitle:string,
         * videoOwnerChannelId:string
         * }
         * }>}
         */
		this.getLastVideoByChannelId = async (id) => {

			const channel = await this.GET.channelById(id);

			if (channel.ok) {

				if (!channel.data.contentDetails) {
					return { ok:response.ok, status:response.status, statusText:response.statusText, data:{} };
				}

				const relatedUploads = channel.data.contentDetails.relatedPlaylists.uploads;
				const response = await fetch(`https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${relatedUploads}&order=date&maxResults=1&key=${this.apiKey}`);

				if (response.ok) {
					const data = await response.json();
					return { ok:response.ok, status:response.status, statusText:response.statusText, data:data.items ? data.items[0].snippet : {} };
				}
				else {
					return { ok:response.ok, status:response.status, statusText:response.statusText, data:{} };
				}

			}
			else {
				return { ok:channel.ok, status:channel.status, statusText:channel.statusText };
			}
		};

	}

};
